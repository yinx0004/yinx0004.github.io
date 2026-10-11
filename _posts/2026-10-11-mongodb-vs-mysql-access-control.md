---
layout: post
title: "用 MySQL 的经验理解 MongoDB 鉴权：账号、角色与集群内部认证"
date: 2026-10-11
permalink: /posts/2026/10/mongodb-vs-mysql-access-control/
lang: zh-CN
ref: mongodb-mysql-access-control
category: MongoDB
tags: [MongoDB, MySQL, 鉴权, 访问控制, 副本集, 分片集群, 安全]
description: "从 MySQL 的账号和权限模型出发，对照 MongoDB 的认证库、角色、localhost exception、keyfile 内部认证和分片集群用户，每个差异都用 MySQL 8.4 和 MongoDB 8.0 实测复现。"
imagefeature: cover10.jpg
comments: true
featured: true
toc: true
---
从 MySQL 转到 MongoDB 的人，很少会在 CRUD 上卡住，卡住的往往是鉴权：用户明明建了，连接却报 Authentication failed；角色授了，权限却不是想象中的那样；副本集开了认证以后，节点之间互相连不上。原因多半是带着 MySQL 的心智模型去理解 MongoDB，而两者在几个关键地方并不一样。

这篇文章按 MySQL 的概念顺序，逐个对照 MongoDB 的做法，重点放在差异和容易踩的坑上。文中所有命令和输出都来自一套本地实验环境：

- MySQL 8.4
- MongoDB 8.0.4，一个 3 节点副本集 rs0，另有一个最小的分片集群（1 个 config server、1 个分片、1 个 mongos）
- 两台客户端容器 client-a（172.30.0.21）和 client-b（172.30.0.22），用来演示按来源 IP 限制登录

MySQL 用的是 8.4。还在用 8.0 的话，和认证相关的主要差别有几处：8.0 默认仍启用 `mysql_native_password`，8.4 默认禁用，用它创建账号会报 `Plugin 'mysql_native_password' is not loaded`；8.4 去掉了 `default_authentication_plugin` 变量，改用 `authentication_policy`；8.4 还去掉了 `SHOW SLAVE STATUS` 这类旧的复制语法。依赖 `mysql_native_password` 的老驱动连 8.4 会失败，需要用 `--mysql-native-password=ON` 显式打开，而到了 9.0 这个插件已经被移除。

实验环境的代码在 GitHub 上：[mongo-mysql-auth-lab](https://github.com/yinx0004/mongo-mysql-auth-lab)，`./lab.sh up` 启动环境，`./lab.sh run 00` 到 `11` 分别对应文中各节，其中 10 是 MySQL 8.0 和 8.4 的对比，11 是 MySQL 复制账号需要的权限。命令都是完整的；输出里过长的部分，比如报错信息里的 lsid 和 $clusterTime，我用 `...` 省略了。

## 先分清认证和授权

认证（authentication）回答"你是谁"，授权（authorization）回答"你能做什么"。这两步合起来，中文里常被统称为鉴权，本文标题用的就是这个意思；下文提到具体某一步时，只用认证和授权。MySQL 和 MongoDB 都有这两步，但组合方式不一样，后面很多差异都可以追溯到这里。

MySQL 把两者绑在一起。建立连接时必须先完成认证：用户名、来源主机和密码要匹配上 mysql.user 里的某个账号，才会有会话；之后每执行一条语句，再按授权表检查权限。不存在"先连上、还没认证"的状态：

```
[client-a]$ mysql -h mysql -e 'SELECT 1'
ERROR 1045 (28000): Access denied for user 'root'@'172.30.0.21' (using password: NO)
```

唯一能把认证和授权一起关掉的是 `--skip-grant-tables`，一般只在找回 root 密码这类紧急情况下使用。

MongoDB 把两者拆开了。开启访问控制以后，没认证的连接照样能建立，只是除了 hello、ping 这类命令以外什么都做不了：

```
[client-a]$ mongosh "mongodb://mongo1:27017/?directConnection=true" \
    --eval 'print("ping:", db.adminCommand({ping: 1}).ok);
            print("hello.me:", db.hello().me);
            db.adminCommand({listDatabases: 1})'
ping: 1
hello.me: mongo1:27017
MongoServerError: Command listDatabases requires authentication
```

更关键的是，授权是一个单独的开关，也就是配置里的 `security.authorization`，默认关闭，开启集群内部认证（keyfile 或 x509）时会自动打开。授权关闭时，连接如果带了用户名和密码，密码照样会被验证，错了一样报 Authentication failed；可一旦验证通过，权限就不再检查了。下面是一个没开访问控制的单机 mongod，用户 reader 只有 shop 库的 read 角色：

```
[client-a]$ mongosh "mongodb://reader:wrong-pw@noauth:27017/shop" --eval 'db.orders.countDocuments()'
MongoServerError: Authentication failed.

[client-a]$ mongosh "mongodb://reader:reader-pw@noauth:27017/shop" \
    --eval 'print(JSON.stringify(db.runCommand({connectionStatus: 1}).authInfo.authenticatedUsers));
            db.orders.insertOne({item: "pen"}).acknowledged'
[{"user":"reader","db":"shop"}]
true
```

reader 认证成功了，只读角色却写入成功。所以"用户都建好了，密码也验证通过了"并不代表集群受到了保护，要确认授权真的开着。可以看启动参数，`parsed` 里没有 `security` 一项就说明没开：

```
[client-a]$ mongosh "mongodb://reader:reader-pw@noauth:27017/shop" \
    --eval 'JSON.stringify(db.adminCommand({getCmdLineOpts: 1}).parsed)'
{"net":{"bindIp":"*"}}
```

分清这两步，报错也就好理解了：

| 报错 | 哪一步出的问题 | 含义 |
|---|---|---|
| MySQL `ERROR 1045 Access denied for user` | 认证 | 账号不存在、主机不匹配或密码错误 |
| MySQL `ERROR 1142` / `1143 command denied` | 授权 | 已经登录，但没有这张表或这一列的权限 |
| MongoDB `Authentication failed` | 认证 | 认证库里没有这个用户、密码错误，或不满足来源限制 |
| MongoDB `Command <命令名> requires authentication` | 还没认证 | 访问控制已开启，这个连接没有认证 |
| MongoDB `not authorized on <库名> to execute command` | 授权 | 已经认证，但角色里没有这个操作 |

## 账号是什么：user@host 和认证库

在 MySQL 里，账号由用户名和主机两部分组成，`'alice'@'%'` 和 `'alice'@'172.30.0.21'` 是两个完全独立的账号，可以有不同的密码和权限：

```sql
CREATE USER 'alice'@'%'           IDENTIFIED BY 'alice-any-host';
CREATE USER 'alice'@'172.30.0.21' IDENTIFIED BY 'alice-client-a';
```

从 client-a 登录时，MySQL 会优先匹配更具体的主机，所以只有 client-a 那个账号的密码能用：

```
[client-a]$ mysql -h mysql -u alice -p -e "SELECT USER(), CURRENT_USER()"
+-------------------+-------------------+
| USER()            | CURRENT_USER()    |
+-------------------+-------------------+
| alice@172.30.0.21 | alice@172.30.0.21 |
+-------------------+-------------------+

[client-a]$ mysql -h mysql -u alice -p     # 用 'alice'@'%' 的密码
ERROR 1045 (28000): Access denied for user 'alice'@'172.30.0.21' (using password: YES)
```

从 client-b 登录，只能匹配到 `'alice'@'%'`，`CURRENT_USER()` 也随之变成 `alice@%`。

MongoDB 的账号里没有主机，取而代之的是认证库（authentication database）：用户在哪个库里创建，就属于哪个库。shop 库里的 alice 和 admin 库里的 alice 是两个不同的用户：

```js
db.getSiblingDB("shop").createUser({user: "alice", pwd: "alice-shop",
  roles: [{role: "readWrite", db: "shop"}]})
db.getSiblingDB("admin").createUser({user: "alice", pwd: "alice-admin",
  roles: [{role: "read", db: "reports"}]})
```

不管在哪个库创建，用户文档其实都存在 `admin.system.users` 里，`_id` 是"认证库.用户名"：

```
{"_id":"admin.alice","user":"alice","db":"admin","roles":[{"role":"read","db":"reports"}]}
{"_id":"shop.alice","user":"alice","db":"shop","roles":[{"role":"readWrite","db":"shop"}]}
```

认证库只决定这个用户在哪里验证身份，不限制它能访问哪些库。admin 库的 alice 拥有的是 reports 库的读权限。

因为身份里没有主机，同一个用户从 client-a 和 client-b 登录没有任何区别。想按来源限制，要用后面讲的 authenticationRestrictions。

## authSource：最常见的 Authentication failed

先看 MongoDB 连接串的格式。驱动、mongosh 和各种工具用的都是同一种 URI：

```
mongodb://用户名:密码@主机1:端口1,主机2:端口2/默认库?选项1=值1&选项2=值2
```

以本文用到的一个连接串为例：

```
mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0&authSource=shop
```

| 部分 | 本例 | 说明 |
|---|---|---|
| 协议 | `mongodb://` | 另一种是 `mongodb+srv://`，主机列表从 DNS 的 SRV 记录里取，Atlas 用的就是这种 |
| 用户名和密码 | `alice:alice-shop@` | 可以省略，省略就是不认证。密码里有 `@`、`:`、`/`、`?`、`#`、`%` 这类字符时，要做百分号编码，比如 `@` 写成 `%40` |
| 主机列表 | `mongo1:27017,mongo2:27017,mongo3:27017` | 种子列表。驱动连上其中任意一个，就能从它那里拿到副本集的全部成员，所以不必写全，但最好多写几个，以防其中一个正好不可用 |
| 默认库 | `/shop` | 不指定库时操作的库，同时也是 authSource 的默认值，这一点下面细说 |
| replicaSet | `rs0` | 按副本集方式连接，驱动会自动找到主节点，主节点切换后也会跟着切 |
| authSource | `shop` | 去哪个库验证用户名和密码 |

其他常用的选项还有 `directConnection=true`（只连这一个节点，不做副本集发现，本文直连某个成员或分片时用的就是它）、`tls=true`、`readPreference`、`w`，以及 `appName`。`appName` 会出现在服务端日志和 `currentOp` 里，排查时很容易认出是哪个应用的连接。它是客户端自己上报的，驱动默认不设置，服务端也不校验，所以要在每个服务的连接串里显式写上，并且不能拿它做访问控制。

要注意，mongosh 连单个主机且没写 `replicaSet` 时，会自动加上 `directConnection=true`。如果这个主机恰好是从节点，写入会直接报错：

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017/shop" \
    --eval 'print(db.getMongo()._uri); db.orders.insertOne({x: 1})'
mongodb://alice:alice-shop@mongo1:27017/shop?directConnection=true&appName=mongosh+2.3.8
MongoServerError: not primary
```

对比 MySQL：`mysql -h mysql -u alice -p shop`，或者 JDBC 的 `jdbc:mysql://mysql:3306/shop`，里面的库名只是连上以后默认使用的 schema，和身份验证没有关系，因为 MySQL 没有认证库这个概念。MongoDB 连接串里的库名却会影响认证。

连接时，客户端必须告诉服务端去哪个库验证身份，这就是 `authSource`。坑在于它的默认值：如果连接串的路径里写了库名，这个库名会被当作默认的 authSource；路径里没写，默认是 admin。

路径里写的正好是认证库，一切正常：

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.orders.findOne()'
{ _id: 1, item: 'book' }
```

路径里不写库名，authSource 回落到 admin，而 admin 库里的 alice 是另一个密码：

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0" \
    --eval 'db.getSiblingDB("shop").orders.findOne()'
MongoServerError: Authentication failed.
```

反过来的情况更隐蔽。路径里写的是想要使用的库，它同时也成了 authSource：

```
[client-a]$ mongosh "mongodb://alice:alice-admin@mongo1:27017,mongo2:27017,mongo3:27017/reports?replicaSet=rs0" \
    --eval 'db.getName()'
MongoServerError: Authentication failed.

[client-a]$ mongosh "mongodb://alice:alice-admin@mongo1:27017,mongo2:27017,mongo3:27017/reports?replicaSet=rs0&authSource=admin" \
    --eval 'db.getName()'
reports
```

客户端拿到的永远是同一句 Authentication failed。要知道具体原因，得看服务端日志里 `"msg":"Failed to authenticate"` 那一行的 error 字段，上面两次失败分别是：

```
user=alice db=admin    error: AuthenticationFailed: SCRAM authentication failed, storedKey mismatch
user=alice db=reports  error: UserNotFound: Could not find user "alice" for db "reports"
```

UserNotFound 说明 authSource 不对，storedKey mismatch 说明这个库里确实有这个用户，但密码不对。我的建议是，生产环境的连接串一律显式写上 `authSource`，不依赖默认值。

## 限制登录来源

MySQL 把允许的主机直接写在账号里：

```sql
CREATE USER 'report'@'172.30.0.21' IDENTIFIED BY 'report-pw';
```

```
[client-b]$ mysql -h mysql -u report -p -e "SELECT CURRENT_USER()"
ERROR 1045 (28000): Access denied for user 'report'@'172.30.0.22' (using password: YES)
```

MongoDB 对应的是用户上的 `authenticationRestrictions`，`clientSource` 填允许的客户端 IP 或网段，`serverAddress` 可以限制客户端连的是哪个服务端地址：

```js
db.getSiblingDB("admin").createUser({user: "report", pwd: "report-pw",
  roles: [{role: "read", db: "reports"}],
  authenticationRestrictions: [{clientSource: ["172.30.0.21"]}]})
```

从 client-a 登录成功，从 client-b 登录失败。客户端看到的仍然只是 Authentication failed，连 `Failed to authenticate` 那行日志里的 error 也只写了 Authentication failed。真正的原因在它前面的另一行日志里：

```
Failed to acquire user because of unmet authentication restrictions
reason: Evaluation of direct authentication restrictions failed:
        Restriction '{anyOf: [{allOf: [{"clientSource": ["172.30.0.21/32"]}]}]}' ... unmet
```

authenticationRestrictions 也可以设置在角色上，这样拥有该角色的用户都会继承这个限制。很多从 MySQL 过来的人不知道 MongoDB 有这个功能，以为只能靠防火墙和 `bindIp` 控制来源。

## 授权：GRANT 与角色

MySQL 8.0 引入了角色，但角色授予用户以后，默认并不生效：

```sql
CREATE ROLE 'app_read';
GRANT SELECT ON shop.* TO 'app_read';
CREATE USER 'bob'@'%' IDENTIFIED BY 'bob-pw';
GRANT 'app_read' TO 'bob'@'%';
```

```
[client-a]$ mysql -h mysql -u bob -p -e "SHOW GRANTS; SELECT CURRENT_ROLE(); SELECT * FROM shop.orders"
+-----------------------------------+
| Grants for bob@%                  |
+-----------------------------------+
| GRANT USAGE ON *.* TO `bob`@`%`   |
| GRANT `app_read`@`%` TO `bob`@`%` |
+-----------------------------------+
+----------------+
| CURRENT_ROLE() |
+----------------+
| NONE           |
+----------------+
ERROR 1142 (42000) at line 1: SELECT command denied to user 'bob'@'172.30.0.21' for table 'orders'
```

角色已经授予，但当前会话没有激活任何角色。激活角色分三个层面。`SET ROLE` 只作用于当前会话，新开的会话又回到没有角色的状态：

```
[client-a]$ mysql -h mysql -u bob -p -e "SET ROLE 'app_read'; SELECT CURRENT_ROLE(); SELECT * FROM shop.orders"
+----------------+
| CURRENT_ROLE() |
+----------------+
| `app_read`@`%` |
+----------------+
+----+------+
| id | item |
+----+------+
|  1 | book |
+----+------+
[client-a]$ mysql -h mysql -u bob -p -e "SELECT CURRENT_ROLE()"
+----------------+
| CURRENT_ROLE() |
+----------------+
| NONE           |
+----------------+
```

`SET DEFAULT ROLE 'app_read' TO 'bob'@'%'` 作用于这个账号以后的每次登录，对已经打开的会话不起作用。全局参数 `activate_all_roles_on_login` 则作用于整个实例，打开后所有账号登录时都会激活自己被授予的全部角色。另外，MySQL 一直都可以绕过角色，直接把权限授予用户，比如 `GRANT INSERT ON shop.orders TO 'bob'@'%'`。

MongoDB 正好相反：权限只能放在角色里，用户只能绑定角色。`createUser` 根本没有接收权限的字段：

```
> db.getSiblingDB("shop").createUser({user: "bob", pwd: "bob-pw", roles: [],
    privileges: [{resource: {db: "shop", collection: "orders"}, actions: ["find"]}]})
MongoServerError: BSON field 'createUser.privileges' is an unknown field.
```

所以要先建一个自定义角色，权限由资源（库、集合，或者整个集群）加一组操作（find、insert、createIndex 等）组成：

```js
db.getSiblingDB("shop").createRole({role: "orderReader", roles: [],
  privileges: [{resource: {db: "shop", collection: "orders"}, actions: ["find"]}]})
db.getSiblingDB("shop").createUser({user: "bob", pwd: "bob-pw", roles: ["orderReader"]})
```

角色授予后立即生效，不需要激活。bob 能读 orders，读 customers 会被拒绝：

```
[client-a]$ mongosh "mongodb://bob:bob-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers.findOne()'
MongoServerError: not authorized on shop to execute command { find: "customers", filter: {}, limit: 1, ... }
```

MongoDB 也没有默认角色。`roles` 是 createUser 的必填字段，省略会直接报错：

```
> db.getSiblingDB("shop").runCommand({createUser: "nobody", pwd: "nobody-pw"})
MongoServerError: BSON field 'createUser.roles' is missing but a required field
```

可以显式写 `roles: []`。这样的用户能通过认证，但 `authenticatedUserRoles` 是空的，读数据、列集合，甚至改自己的密码都不行，差不多相当于 MySQL 里只有 USAGE 的新账号：

```
[client-a]$ mongosh "mongodb://nobody:nobody-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.runCommand({connectionStatus: 1}).authInfo'
{
  authenticatedUsers: [ { user: 'nobody', db: 'shop' } ],
  authenticatedUserRoles: []
}
[client-a]$ mongosh "mongodb://nobody:nobody-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.changeUserPassword("nobody", "new-pw")'
MongoServerError: not authorized on shop to execute command { updateUser: "nobody", pwd: "xxx", ... }
```

还有一个规则：建在普通库里的角色，权限只能作用于这个库；只有建在 admin 库里的角色，才能包含其他库或集群级别的权限。

MongoDB 的内置角色可以大致这样对应到 MySQL：

| MongoDB 内置角色 | 大致相当于 MySQL |
|---|---|
| read | `GRANT SELECT ON db.*` |
| readWrite | `GRANT SELECT, INSERT, UPDATE, DELETE ON db.*`，外加建集合、建索引 |
| dbAdmin | 库级的 DDL、统计和 profiler，但不能读业务数据 |
| userAdmin | 在这个库里建用户、建角色、授权 |
| dbOwner | `GRANT ALL ON db.*`，包含上面三个 |
| readAnyDatabase、readWriteAnyDatabase 等 | `ON *.*` 的版本 |
| root | 接近 MySQL 的 root |

在把管理权限拆细这件事上，MySQL 8.0 向 MongoDB 靠近了一步。以前的管理类权限集中在一个 `SUPER` 上，8.0 把它拆成了一组按功能划分的动态权限，比如修改系统变量的 `SYSTEM_VARIABLES_ADMIN`、杀别人连接的 `CONNECTION_ADMIN`、管理 binlog 的 `BINLOG_ADMIN`，`SUPER` 本身被标记为废弃。动态权限只能授予在全局级别（`ON *.*`），存在 `mysql.global_grants` 表里，插件和组件也可以注册自己的动态权限：

```
[client-a]$ mysql -h mysql -u root -p -e "GRANT SUPER ON *.* TO 'ops'@'%'; SHOW WARNINGS"
+---------+------+----------------------------------------------+
| Level   | Code | Message                                      |
+---------+------+----------------------------------------------+
| Warning | 1287 | The SUPER privilege identifier is deprecated |
+---------+------+----------------------------------------------+
[client-a]$ mysql -h mysql -u root -p -e "GRANT BINLOG_ADMIN ON shop.* TO 'ops'@'%'"
ERROR 3619 (HY000) at line 1: Illegal privilege level specified for BINLOG_ADMIN
[client-a]$ mysql -h mysql -u root -p -e "REVOKE SUPER ON *.* FROM 'ops'@'%'; GRANT SYSTEM_VARIABLES_ADMIN, CONNECTION_ADMIN ON *.* TO 'ops'@'%'; SELECT * FROM mysql.global_grants WHERE USER = 'ops'"
+------+------+------------------------+-------------------+
| USER | HOST | PRIV                   | WITH_GRANT_OPTION |
+------+------+------------------------+-------------------+
| ops  | %    | CONNECTION_ADMIN       | N                 |
| ops  | %    | SYSTEM_VARIABLES_ADMIN | N                 |
+------+------+------------------------+-------------------+
```

对应到 MongoDB，就是集群资源上的 `setParameter`、`killop`、`replSetConfigure` 这类操作。动态和静态权限在生效时机上也不一样，下文"权限改了什么时候生效"一节有实测。

内置角色里，userAdmin 值得单独说一句。在 MySQL 里，`WITH GRANT OPTION` 只能把自己已有的权限转授给别人。MongoDB 的 userAdmin 可以把这个库的任意角色授予任何用户，包括它自己：

```
[client-a]$ mongosh "mongodb://ua:ua-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.orders.findOne()'
MongoServerError: not authorized on shop to execute command { find: "orders", ... }

[client-a]$ mongosh "mongodb://ua:ua-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.grantRolesToUser("ua", ["dbOwner"]); db.orders.findOne()'
{ _id: 1, item: 'book' }
```

所以拥有某个库的 userAdmin，实际上就等于拥有这个库的全部权限；admin 库上的 userAdminAnyDatabase 则相当于整个集群的 root。分配这两个角色时要按最高权限来对待。

## 列级权限和视图

MySQL 的权限可以细到列：

```sql
GRANT SELECT (id, name) ON shop.customers TO 'carol'@'%';
```

```
[client-a]$ mysql -h mysql -u carol -p -e "SELECT id, name FROM shop.customers"
+----+------+
| id | name |
+----+------+
|  1 | Ann  |
+----+------+
[client-a]$ mysql -h mysql -u carol -p -e "SELECT * FROM shop.customers"
ERROR 1142 (42000) at line 1: SELECT command denied to user 'carol'@'172.30.0.21' for table 'customers'
[client-a]$ mysql -h mysql -u carol -p -e "SELECT name, phone FROM shop.customers"
ERROR 1143 (42000) at line 1: SELECT command denied to user 'carol'@'172.30.0.21' for column 'phone' in table 'customers'
```

顺带一提，`SELECT *` 碰到没有权限的列，报的是表级的 1142，明确选了没有权限的列才是列级的 1143，排查时不要被误导。

MongoDB 的权限只到集合，没有字段级权限。要对某些用户隐藏字段，常见做法是建一个视图，只把视图授权出去：

```js
db.getSiblingDB("shop").createView("customers_public", "customers", [{$project: {phone: 0, email: 0}}])
db.getSiblingDB("shop").createRole({role: "publicReader", roles: [],
  privileges: [{resource: {db: "shop", collection: "customers_public"}, actions: ["find"]}]})
```

用户只需要视图的 find 权限，不需要底层集合的权限：

```
[client-a]$ mongosh "mongodb://carol:carol-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers_public.find().toArray()'
[ { _id: 1, name: 'Ann' } ]
[client-a]$ mongosh "mongodb://carol:carol-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers.find().toArray()'
MongoServerError: not authorized on shop to execute command { find: "customers", ... }
```

视图是只读的，需要按字段控制写入的场景，只能在应用层处理。如果目的是防止 DBA 或者能接触到存储的人看到敏感字段，那是另一类问题，要用客户端字段级加密（CSFLE）或 Queryable Encryption，而不是权限。

## 权限改了什么时候生效：FLUSH PRIVILEGES

很多 MySQL 教程会在 GRANT 后面跟一句 `FLUSH PRIVILEGES`，其实这是多余的。GRANT、REVOKE、CREATE USER、ALTER USER 这些账号管理语句，会同时更新授权表和内存里的权限缓存，执行完立即生效：

```
[client-a]$ mysql -h mysql -u dave -p -e "SELECT * FROM shop.orders"
ERROR 1142 (42000) at line 1: SELECT command denied to user 'dave'@'172.30.0.21' for table 'orders'

mysql> GRANT SELECT ON shop.orders TO 'dave'@'%';

[client-a]$ mysql -h mysql -u dave -p -e "SELECT * FROM shop.orders"
+----+------+
| id | item |
+----+------+
|  1 | book |
+----+------+
```

`FLUSH PRIVILEGES` 的作用是让 MySQL 从授权表重新加载权限缓存。只有绕过账号管理语句，直接用 INSERT、UPDATE、DELETE 改了 mysql.user 这类表时才需要它。比如直接把账号的锁定标记改成 Y，在 FLUSH 之前完全不生效：

```
mysql> UPDATE mysql.user SET account_locked = 'Y' WHERE user = 'dave';

[client-a]$ mysql -h mysql -u dave -p -e "SELECT CURRENT_USER()"
+----------------+
| CURRENT_USER() |
+----------------+
| dave@%         |
+----------------+

mysql> FLUSH PRIVILEGES;

[client-a]$ mysql -h mysql -u dave -p -e "SELECT CURRENT_USER()"
ERROR 3118 (HY000): Access denied for user 'dave'@'172.30.0.21'. Account is locked.
```

另一个容易忽略的是已经打开的会话。官方文档把规则分成几类：表级和列级权限的变更，从会话的下一条语句开始生效；库级权限的变更，在下一次 USE 时生效；静态全局权限和密码的变更，对已经连上的会话不生效，要等重新连接；动态全局权限的变更则立即生效。静态全局权限是 `SELECT ON *.*`、`PROCESS`、`SUPER` 这类传统权限，动态全局权限是 8.0 以后按功能拆出来的 `SESSION_VARIABLES_ADMIN`、`BACKUP_ADMIN`、`CONNECTION_ADMIN` 等，`SHOW PRIVILEGES` 可以列出全部。

我按这几类各准备了一个用户。每人打开一个会话，执行一条语句，等 4 秒再执行一次，在第 2 秒时收回各自的权限：

| 用户 | 被收回的权限 | 同一会话里的第二次执行 |
|---|---|---|
| dave | 表级 `SELECT ON shop.orders` | 被拒绝（1142） |
| hank | 库级 `SELECT ON shop.*`，会话已经 `USE shop` | 仍然成功，到下一次 `USE shop` 才被拒绝（1044） |
| ivy | 库级 `SELECT ON shop.*`，会话没有 USE 过 | 被拒绝（1142） |
| erin | 静态全局 `SELECT ON *.*` | 仍然成功，新开的会话才被拒绝 |
| gina | 动态全局 `SESSION_VARIABLES_ADMIN` | 被拒绝（1227） |
| jack | 已激活的角色（角色里是 `SELECT ON shop.*`） | 被拒绝（1142） |

hank 和 ivy 的对比说明，"库级权限在下次 USE 时生效"指的是会话当前所在的库：这个库的库级权限缓存在会话里，直到切换数据库。没有切到这个库的会话，下一条语句就会按新权限检查。hank 的会话是这样的：

```
[client-a]$ mysql -h mysql -u hank -p -N shop -e "SELECT 'before', COUNT(*) FROM orders; SELECT SLEEP(4) INTO @x; SELECT 'after', COUNT(*) FROM orders; USE shop; SELECT 'after USE', COUNT(*) FROM orders"
before  1
after   1
ERROR 1044 (42000) at line 1: Access denied for user 'hank'@'%' to database 'shop'
```

erin 和 gina 的对比则是静态和动态全局权限的区别：

```
[client-a]$ mysql -h mysql -u erin -p -N -e "SELECT 'before', COUNT(*) FROM shop.orders; SELECT SLEEP(4) INTO @x; SELECT 'after', COUNT(*) FROM shop.orders"
before  1
after   1

[client-a]$ mysql -h mysql -u gina -p -N -e "SET SESSION sql_log_bin = 1; SELECT 'before: SET ok'; SELECT SLEEP(4) INTO @x; SET SESSION sql_log_bin = 1; SELECT 'after: SET ok'"
before: SET ok
ERROR 1227 (42000) at line 1: Access denied; you need (at least one of) the SUPER, SYSTEM_VARIABLES_ADMIN or SESSION_VARIABLES_ADMIN privilege(s) for this operation
```

所以收回静态全局权限，或者收回某个库的库级权限时，如果要求立即生效，还要把这个用户已有的连接 KILL 掉。

MongoDB 没有 FLUSH PRIVILEGES，用户和角色只能通过 createUser、grantRolesToUser 这类命令修改，修改后各成员的用户缓存随之失效。在副本集里，收回角色对已经打开的连接也立即生效。frank 用同一个连接读一次，等 4 秒再读，中间收回了他的 read 角色：

```
[client-a]$ mongosh "mongodb://frank:frank-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'print("before:", db.orders.countDocuments());
            sleep(4000);
            print("after:", db.orders.countDocuments())'
before: 1
MongoServerError: not authorized on shop to execute command { aggregate: "orders", ... }
```

MongoDB 也没有类似 `SET ROLE` 的会话级激活，授予用户的角色始终全部生效，所以不存在"会话级"和"全局"之分。连登录来源限制都会作用到已经打开的连接上。kim 从 client-b 连上并读了一次，这时给 kim 加上只允许 client-a 登录的限制，同一个连接的下一次读取直接变成了未认证：

```
[client-b]$ mongosh "mongodb://kim:kim-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'print("before:", db.orders.countDocuments());
            sleep(4000);
            print("after:", db.orders.countDocuments())'
before: 1
MongoServerError: Command aggregate requires authentication
```

第 2 秒执行的是 `db.getSiblingDB("shop").updateUser("kim", {authenticationRestrictions: [{clientSource: ["172.30.0.21"]}]})`。服务端日志里对应的一行是 `Removed user with unmet authentication restrictions from session cache of user information`，也就是把这个用户从连接上移除了。MySQL 改登录主机要用 `RENAME USER`，主机只在建立连接时检查，已经打开的会话不会被断开。我在一个从 client-b 打开的会话期间执行了 `RENAME USER 'lee'@'%' TO 'lee'@'172.30.0.21'`，这个会话仍然连着，但表级权限跟着账号一起改了名，下一条读取报 `ERROR 1142`；从 client-b 新开会话则直接报 `ERROR 1045`。两边都让这个用户读不了数据，区别在于 MongoDB 把连接变成了未认证，MySQL 的会话还在，只是没了权限。

分片集群是个例外。mongos 也会缓存用户信息，按参数 `userCacheInvalidationIntervalSecs` 的设置（默认 30 秒）定期检查缓存是否过期，所以通过一个 mongos 修改的权限，在其他 mongos 上最多可能晚 30 秒生效。需要立即生效时，可以在每个 mongos 上执行 `db.adminCommand({invalidateUserCache: 1})`，这大概是 MongoDB 里最接近 FLUSH PRIVILEGES 的东西。这一点我没有在 lab 里复现，依据的是官方文档。

## 第一个用户：localhost exception

MySQL 在初始化时就会处理 root 密码：`mysqld --initialize` 生成一个临时密码，Docker 镜像要求传入 `MYSQL_ROOT_PASSWORD` 或者显式选择随机、空密码。除非用 `--initialize-insecure` 故意建一个空密码的 root，MySQL 从第一天起就是开启认证的。

MongoDB 的做法是 localhost exception：开启了访问控制，但系统里一个用户都没有时，来自本机（localhost）的连接可以创建第一个用户。在一个开着 keyfile 认证、还没初始化的副本集上：

```
[client-a]$ mongosh "mongodb://mongo1:27017/?directConnection=true" --eval 'rs.initiate()'
MongoServerError: Command replSetInitiate requires authentication

[mongo1]$ mongosh --eval 'rs.initiate({_id: "rs0", members: [
    {_id: 0, host: "mongo1:27017"}, {_id: 1, host: "mongo2:27017"}, {_id: 2, host: "mongo3:27017"}]}).ok'
1
```

远程连接什么都做不了，本机连接可以初始化副本集，但仍然不能读写数据：

```
[mongo1]$ mongosh --eval 'db.getSiblingDB("shop").orders.insertOne({item: "book"})'
MongoServerError: not authorized on shop to execute command { insert: "orders", ... }
```

它能做的就是创建第一个用户。管理员密码事先放在环境变量 PW 里，避免出现在命令行和 shell 历史中。创建完成后，例外立即关闭，本机连接也必须认证：

```
[mongo1]$ mongosh admin --eval 'db.createUser({user: "admin", pwd: process.env.PW, roles: ["root"]}).ok'
1
[mongo1]$ mongosh --eval 'db.getSiblingDB("admin").createUser({user: "second", pwd: "second-pw", roles: ["root"]})'
MongoServerError: Command createUser requires authentication
```

实验中我还发现一个细节：把最后一个用户删掉以后，localhost exception 并不会马上重新打开，要等 mongod 重启。看起来 mongod 会记住"曾经有过用户"这件事，重启后才重新检查。如果不需要这个例外，可以用参数 `enableLocalhostAuthBypass=false` 把它关掉。

## 集群内部认证：keyfile

MySQL 的主从复制用的是一个普通账号，复制本身只需要 `REPLICATION SLAVE` 权限，从库用这个账号连主库拉 binlog。很多环境还会一起授予 `REPLICATION CLIENT`，它允许执行 `SHOW BINARY LOG STATUS`、`SHOW BINARY LOGS` 这类查看状态的语句，监控和高可用工具会用到，但不是复制必需的。复制相关的语句从 8.0.22 起陆续改成了 SOURCE、REPLICA 的叫法，8.4 里 `SHOW SLAVE STATUS` 这类旧语法已经直接报语法错误，但这个权限名一直没改，在 8.0 和 8.4 里写 `GRANT REPLICATION REPLICA` 都会报语法错误。

MongoDB 副本集成员之间不用业务账号，而是内部认证（internal authentication），常见的方式是 keyfile：所有成员持有同一个密钥文件，启动时加上 `--keyFile`。在服务端日志里，成员之间的认证是这样的：

```
"msg":"Successfully authenticated","attr":{"client":"172.30.0.13:32994","isClusterMember":true,
  "mechanism":"SCRAM-SHA-256","user":"__system","db":"local",...}
```

成员以内置的 `__system@local` 身份、用 SCRAM-SHA-256 互相认证，密码由 keyfile 派生。有两点要注意：一是开启内部认证会同时开启客户端授权，官方文档的原话是 "Enabling internal authentication also enables client authorization"，所以不需要再单独配置 `security.authorization`。这对 keyfile 和 x509 两种内部认证都成立，例外是过渡期的 `--transitionToAuth`，下文会讲到。二是 keyfile 的权限不能对其他用户可读，否则 mongod 拒绝启动。

内部认证的另一种方式是 x509 证书。x509 在 MongoDB 里有两种用途，一是客户端用证书登录，二是成员之间用证书做内部认证。前者在自建环境里很少见，后者是官方推荐的生产配置，但实际上用 keyfile 的团队仍然很多。另外要分清，开启 TLS 加密传输不等于用 x509 认证，很多集群开着 TLS，认证用的仍然是密码。

## 给运行中的副本集开启认证

MongoDB 默认不开启访问控制。一个没有开认证的副本集，任何能连上端口的人都能做任何事：

```
[client-b]$ mongosh "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0" \
    --eval 'db.getSiblingDB("admin").runCommand({listDatabases: 1}).databases.map(d => d.name)'
[ 'admin', 'config', 'local' ]
```

MySQL 没有对应的问题，所以也没有对应的操作。MongoDB 给已经在跑的副本集开启认证，不停机的做法是借助 `--transitionToAuth`，分三步：

1. 在认证还没开启时，先把管理员和业务用户都建好。此时用户已经存在，只是不强制。
2. 逐个成员加上 `--keyFile --transitionToAuth` 重启，先重启从节点，最后对主节点 stepDown 后重启。transitionToAuth 模式下，成员之间用 keyfile 认证，客户端带不带账号都能连。
3. 把所有客户端改成带账号连接，再逐个成员去掉 `--transitionToAuth` 重启，只保留 `--keyFile`。

为了观察对业务的影响，我在 client-a 上跑了两个持续写入的进程，每秒约 10 次插入，一个不带账号，一个用 app 账号。每个阶段的写入统计如下：

| 阶段 | 不带账号的写入 | 带账号的写入 |
|---|---|---|
| 未开认证 | 成功 50，失败 0 | 成功 50，失败 0 |
| 第 2 步：滚动切到 transitionToAuth | 成功 534，失败 0 | 成功 534，失败 0 |
| 第 3 步：滚动切到 keyFile | 成功 353，失败 225 | 成功 563，失败 0 |

带账号的写入全程没有一次失败，主节点 stepDown 时的切换由可重试写入（retryable writes）兜住了。不带账号的写入代表漏改的客户端，在主节点切到 keyFile 模式后开始报错：

```
Command insert requires authentication
```

为什么不能跳过第 2 步？我试着把一个从节点直接从无认证切到 `--keyFile` 重启，20 秒后看副本集状态：

```
mongo1:27017  PRIMARY  health=1
mongo2:27017  (not reachable/healthy)  health=0
mongo3:27017  SECONDARY  health=1
```

这个节点要求其他成员认证，而其他成员没有 keyfile，它自己去连其他成员时，对方也不认识它的认证请求。transitionToAuth 的作用就是让成员在过渡期两种连接都接受。

## 轮换 keyfile

keyfile 用久了需要轮换，但所有成员必须能互相认证，不能一次全换。从 MongoDB 4.2 开始，keyfile 可以写成 YAML 列表，放多个 key：

```yaml
- <旧 key>
- <新 key>
```

轮换分两步：先逐个成员换成同时包含旧 key 和新 key 的 keyfile 并重启；全部完成后，再逐个成员换成只有新 key 的 keyfile 并重启。实验中两步做完，副本集始终健康，主节点也正常切换。

同样，如果跳过第一步，只给一个成员换上新 key，它就会和其他成员失联，状态和上一节一样是 `(not reachable/healthy)`。

## 分片集群：用户存在哪里

分片集群里有两套用户。通过 mongos 创建的用户是集群用户，存在 config server 上：

```
mongos> db.getSiblingDB("admin").createUser({user: "analyst", pwd: "analyst-pw",
          roles: [{role: "read", db: "sales"}]})
mongos> db.getSiblingDB("admin").system.users.find({}, {_id: 1}).toArray()
[ { _id: 'admin.admin' }, { _id: 'admin.analyst' } ]
```

通过 mongos 访问一切正常，但这个用户在分片上并不存在，直连分片会失败，分片的日志里是 UserNotFound：

```
[client-a]$ mongosh "mongodb://analyst:analyst-pw@shard1:27017/sales?authSource=admin&directConnection=true" \
    --eval 'db.orders.countDocuments()'
MongoServerError: Authentication failed.
error: UserNotFound: Could not find user "analyst" for db "admin"
```

更需要注意的是，分片本身一个用户都没有，所以分片上的 localhost exception 仍然是开着的。任何能登录分片所在机器的人，都可以在上面创建一个 root 用户：

```
[shard1]$ mongosh admin --eval 'db.createUser({user: "shardadmin", pwd: "shardadmin-pw", roles: ["root"]}).ok'
1
```

这个分片本地用户只存在于 shard1，mongos 不认识它，用它连 mongos 会认证失败。官方建议给每个分片都创建分片本地的管理员用户，一方面用于直连分片做维护，另一方面也把分片上的 localhost exception 关掉。

## 排查清单

遇到鉴权问题时，可以按报错对照：

| 现象 | 先看哪里 | 常见原因 |
|---|---|---|
| MongoDB 报 Authentication failed | 服务端日志 `Failed to authenticate` 的 error 字段 | UserNotFound：authSource 不对；storedKey mismatch：密码不对 |
| 同上，但 error 只有 Authentication failed | 日志里 `unmet authentication restrictions` | 来源 IP 不在 clientSource 里 |
| 认证失败，但不知道是哪个应用 | 失败日志里的连接号 `connNNN`，再找同一连接的 `client metadata` 日志 | 从里面的 `application.name` 认出应用，前提是应用设置了 appName |
| MongoDB 报 not authorized on <库名> to execute command | `db.runCommand({connectionStatus: 1, showPrivileges: true})` | 角色里缺这个操作或资源 |
| MySQL 报 1142，但角色已经授予 | `SELECT CURRENT_ROLE()` | 角色没有激活 |
| 副本集成员 not reachable/healthy | 该成员的日志 | 成员之间 keyfile 不一致，或认证模式不一致 |
| 日志里有大量 Checking authorization failed，操作是 atlascli 聚合 | 可以忽略 | mongosh 连接后在后台自动执行的探测，权限有限的用户会留下这条日志 |

## 对照速查表

| 话题 | MySQL | MongoDB |
|---|---|---|
| 账号身份 | `'user'@'host'` | 用户名 + 认证库 |
| 连接时指定 | 只需要用户名 | 用户名 + authSource，默认取 URI 路径里的库，没有则为 admin |
| 限制来源 | 账号的 host 部分 | `authenticationRestrictions.clientSource` |
| 授权 | 可以直接授予用户，也可以通过角色 | 只能通过角色 |
| 角色生效 | 需要激活：`SET ROLE`（当前会话）、`SET DEFAULT ROLE`（账号以后的登录）或 `activate_all_roles_on_login`（整个实例） | 授予后立即生效 |
| 最细粒度 | 列 | 集合，字段用视图实现 |
| 权限变更生效 | 账号管理语句立即生效，直接改授权表要 FLUSH PRIVILEGES；静态全局权限、会话当前所在库的库级权限，对已有会话不生效 | 立即生效，包括已有连接；mongos 的用户缓存默认最多 30 秒 |
| 第一个管理员 | 初始化时设置 root 密码 | localhost exception |
| 默认是否开启认证 | 是 | 否 |
| 复制或成员之间认证 | 普通账号 + REPLICATION SLAVE 权限（REPLICATION CLIENT 用于查看状态，非必需） | keyfile 或 x509，以 `__system` 身份 |
| 不停机开启认证 | 不涉及 | `--transitionToAuth` 三步走 |
| 分片集群 | 不涉及 | mongos 用户在 config server，分片另有本地用户 |
