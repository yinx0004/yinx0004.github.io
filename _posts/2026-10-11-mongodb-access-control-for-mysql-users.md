---
layout: post
title: "MongoDB Access Control for MySQL Users: Accounts, Roles and Internal Authentication"
date: 2026-10-11
permalink: /posts/2026/10/mongodb-access-control-for-mysql-users/
lang: en
ref: mongodb-mysql-access-control
category: MongoDB
tags: [MongoDB, MySQL, Access Control, Authentication, Authorization, Replica Set, Sharding, Security]
description: "MongoDB access control explained from the MySQL account and privilege model: authentication databases, roles, the localhost exception, keyfile internal authentication and users in sharded clusters, each difference reproduced on MySQL 8.4 and MongoDB 8.0."
imagefeature: cover10.jpg
comments: true
featured: true
toc: true
---
People who move from MySQL to MongoDB rarely get stuck on CRUD. They get stuck on access control: the user exists but the connection says Authentication failed, a role is granted but the privileges aren't what they expected, or the replica set members stop talking to each other once authentication is turned on. Most of the time the cause is a MySQL mental model applied to MongoDB, and the two differ in a few important places.

This post follows MySQL's concepts in order and compares each one with how MongoDB does it, with the focus on the differences and the traps. All commands and output come from a local lab:

- MySQL 8.4
- MongoDB 8.0.4: a three-member replica set rs0, plus a minimal sharded cluster (one config server, one shard, one mongos)
- Two client containers, client-a (172.30.0.21) and client-b (172.30.0.22), to show login restrictions by client IP

The MySQL examples use 8.4. If you're still on 8.0, the main authentication differences are these: 8.0 still enables `mysql_native_password` by default, while 8.4 disables it, so creating an account with it fails with `Plugin 'mysql_native_password' is not loaded`. 8.4 also removed the `default_authentication_plugin` variable in favor of `authentication_policy`, and dropped old replication syntax such as `SHOW SLAVE STATUS`. Old drivers that only speak `mysql_native_password` can't connect to 8.4 until you turn it on with `--mysql-native-password=ON`, and in 9.0 the plugin is gone.

The lab is on GitHub: [mongo-mysql-auth-lab](https://github.com/yinx0004/mongo-mysql-auth-lab). `./lab.sh up` starts it, and `./lab.sh run 00` to `11` correspond to the sections below; 10 compares MySQL 8.0 with 8.4, and 11 checks the privileges a MySQL replication user needs. Commands are shown in full. In the output, I cut long parts such as the lsid and $clusterTime in error messages and marked them with `...`.

## Authentication and authorization

Authentication answers "who are you", authorization answers "what are you allowed to do". Both MySQL and MongoDB have the two steps, but they put them together differently, and many of the differences later in this post come from here.

MySQL ties them together. A connection has to authenticate first: the user name, client host and password must match an account in mysql.user before there is a session at all, and every statement after that is checked against the grant tables. There is no state where you're connected but not yet authenticated:

```
[client-a]$ mysql -h mysql -e 'SELECT 1'
ERROR 1045 (28000): Access denied for user 'root'@'172.30.0.21' (using password: NO)
```

The only way to switch off both is `--skip-grant-tables`, which is meant for emergencies such as recovering a lost root password.

MongoDB keeps them apart. With access control on, an unauthenticated connection can still be opened, it just can't do anything beyond commands like hello and ping:

```
[client-a]$ mongosh "mongodb://mongo1:27017/?directConnection=true" \
    --eval 'print("ping:", db.adminCommand({ping: 1}).ok);
            print("hello.me:", db.hello().me);
            db.adminCommand({listDatabases: 1})'
ping: 1
hello.me: mongo1:27017
MongoServerError: Command listDatabases requires authentication
```

More importantly, authorization is a separate switch, `security.authorization` in the configuration. It's off by default, and it's turned on automatically when you enable internal authentication (keyfile or x509). With authorization off, a connection that sends a user name and password still has the password checked, and a wrong one still fails with Authentication failed. Once it passes, though, privileges aren't checked at all. Here is a standalone mongod without access control, where the user reader only has the read role on shop:

```
[client-a]$ mongosh "mongodb://reader:wrong-pw@noauth:27017/shop" --eval 'db.orders.countDocuments()'
MongoServerError: Authentication failed.

[client-a]$ mongosh "mongodb://reader:reader-pw@noauth:27017/shop" \
    --eval 'print(JSON.stringify(db.runCommand({connectionStatus: 1}).authInfo.authenticatedUsers));
            db.orders.insertOne({item: "pen"}).acknowledged'
[{"user":"reader","db":"shop"}]
true
```

reader authenticated, and even though it only has the read role, the write went through. So having users with passwords that work doesn't mean the cluster is protected; check that authorization is actually on. In the startup options, no `security` entry under `parsed` means it's off:

```
[client-a]$ mongosh "mongodb://reader:reader-pw@noauth:27017/shop" \
    --eval 'JSON.stringify(db.adminCommand({getCmdLineOpts: 1}).parsed)'
{"net":{"bindIp":"*"}}
```

With the two steps separated, the error messages make more sense:

| Error | Step | Meaning |
|---|---|---|
| MySQL `ERROR 1045 Access denied for user` | Authentication | No such account, the host doesn't match, or the password is wrong |
| MySQL `ERROR 1142` / `1143 command denied` | Authorization | Logged in, but no privilege on this table or column |
| MongoDB `Authentication failed` | Authentication | No such user in the authentication database, wrong password, or a login restriction not met |
| MongoDB `Command <command> requires authentication` | Not authenticated | Access control is on and this connection hasn't authenticated |
| MongoDB `not authorized on <database> to execute command` | Authorization | Authenticated, but no role grants this action |

## What an account is: user@host vs the authentication database

In MySQL an account is a user name plus a host. `'alice'@'%'` and `'alice'@'172.30.0.21'` are two separate accounts that can have different passwords and privileges:

```sql
CREATE USER 'alice'@'%'           IDENTIFIED BY 'alice-any-host';
CREATE USER 'alice'@'172.30.0.21' IDENTIFIED BY 'alice-client-a';
```

When alice logs in from client-a, MySQL matches the more specific host first, so only that account's password works:

```
[client-a]$ mysql -h mysql -u alice -p -e "SELECT USER(), CURRENT_USER()"
+-------------------+-------------------+
| USER()            | CURRENT_USER()    |
+-------------------+-------------------+
| alice@172.30.0.21 | alice@172.30.0.21 |
+-------------------+-------------------+

[client-a]$ mysql -h mysql -u alice -p     # with the password of 'alice'@'%'
ERROR 1045 (28000): Access denied for user 'alice'@'172.30.0.21' (using password: YES)
```

From client-b, only `'alice'@'%'` matches, and `CURRENT_USER()` becomes `alice@%`.

A MongoDB user has no host. Instead it has an authentication database: the database the user was created in. alice in shop and alice in admin are two different users:

```js
db.getSiblingDB("shop").createUser({user: "alice", pwd: "alice-shop",
  roles: [{role: "readWrite", db: "shop"}]})
db.getSiblingDB("admin").createUser({user: "alice", pwd: "alice-admin",
  roles: [{role: "read", db: "reports"}]})
```

Wherever they were created, all user documents are stored in `admin.system.users`, with an `_id` of "authentication database.user name":

```
{"_id":"admin.alice","user":"alice","db":"admin","roles":[{"role":"read","db":"reports"}]}
{"_id":"shop.alice","user":"alice","db":"shop","roles":[{"role":"readWrite","db":"shop"}]}
```

The authentication database only decides where the user's identity is checked. It doesn't limit which databases the user can access: alice in admin has read access to reports.

Since there's no host in the identity, the same user logs in from client-a and client-b in exactly the same way. To restrict where a user can log in from, you use authenticationRestrictions, covered below.

## authSource: the most common Authentication failed

First, the format of a MongoDB connection string. Drivers, mongosh and the other tools all use the same URI:

```
mongodb://user:password@host1:port1,host2:port2/defaultdb?option1=value1&option2=value2
```

Taking one of the connection strings from this post:

```
mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0&authSource=shop
```

| Part | In this example | Notes |
|---|---|---|
| Scheme | `mongodb://` | The other one is `mongodb+srv://`, which reads the host list from DNS SRV records; Atlas uses it |
| User and password | `alice:alice-shop@` | Optional; leave it out and the connection doesn't authenticate. Characters such as `@`, `:`, `/`, `?`, `#` and `%` in the password must be percent-encoded, for example `@` as `%40` |
| Host list | `mongo1:27017,mongo2:27017,mongo3:27017` | A seed list. Once the driver reaches any one of them it learns every member of the replica set, so you don't have to list them all, but list a few in case one is down |
| Default database | `/shop` | The database used when none is specified, and also the default authSource, more on that below |
| replicaSet | `rs0` | Connect as a replica set: the driver finds the primary and follows it after a failover |
| authSource | `shop` | The database where the user name and password are checked |

Other common options are `directConnection=true` (talk to this one node only, without replica set discovery; this post uses it to connect to a specific member or shard), `tls=true`, `readPreference`, `w` and `appName`. `appName` shows up in the server log and in `currentOp`, which makes it easy to tell which application a connection belongs to. It's self-reported by the client: drivers don't set one by default and the server doesn't verify it, so set it explicitly in every service's connection string, and don't use it for access control.

Note that when mongosh connects to a single host without `replicaSet`, it adds `directConnection=true` on its own. If that host happens to be a secondary, writes fail:

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017/shop" \
    --eval 'print(db.getMongo()._uri); db.orders.insertOne({x: 1})'
mongodb://alice:alice-shop@mongo1:27017/shop?directConnection=true&appName=mongosh+2.3.8
MongoServerError: not primary
```

Compare that with MySQL: in `mysql -h mysql -u alice -p shop` or a JDBC URL like `jdbc:mysql://mysql:3306/shop`, the database name is only the default schema after connecting. It has nothing to do with authentication, because MySQL has no authentication database. In a MongoDB connection string, the database name does affect authentication.

When connecting, the client has to tell the server which database to check the credentials against. That's `authSource`, and the trap is its default: if the connection string has a database in the path, that database becomes the default authSource; if it doesn't, the default is admin.

If the path names the authentication database, everything works:

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.orders.findOne()'
{ _id: 1, item: 'book' }
```

Without a database in the path, authSource falls back to admin, where alice has a different password:

```
[client-a]$ mongosh "mongodb://alice:alice-shop@mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0" \
    --eval 'db.getSiblingDB("shop").orders.findOne()'
MongoServerError: Authentication failed.
```

The opposite case is harder to spot. The path names the database you want to work in, and it quietly becomes the authSource too:

```
[client-a]$ mongosh "mongodb://alice:alice-admin@mongo1:27017,mongo2:27017,mongo3:27017/reports?replicaSet=rs0" \
    --eval 'db.getName()'
MongoServerError: Authentication failed.

[client-a]$ mongosh "mongodb://alice:alice-admin@mongo1:27017,mongo2:27017,mongo3:27017/reports?replicaSet=rs0&authSource=admin" \
    --eval 'db.getName()'
reports
```

The client always gets the same Authentication failed. To find the actual reason, look at the error field of the `"msg":"Failed to authenticate"` line in the server log. For the two failures above:

```
user=alice db=admin    error: AuthenticationFailed: SCRAM authentication failed, storedKey mismatch
user=alice db=reports  error: UserNotFound: Could not find user "alice" for db "reports"
```

UserNotFound means the authSource is wrong. storedKey mismatch means the user does exist in that database but the password is wrong. My advice is to always set `authSource` explicitly in production connection strings instead of relying on the default.

## Restricting where users log in from

MySQL writes the allowed host into the account:

```sql
CREATE USER 'report'@'172.30.0.21' IDENTIFIED BY 'report-pw';
```

```
[client-b]$ mysql -h mysql -u report -p -e "SELECT CURRENT_USER()"
ERROR 1045 (28000): Access denied for user 'report'@'172.30.0.22' (using password: YES)
```

The MongoDB equivalent is `authenticationRestrictions` on the user. `clientSource` lists the allowed client IPs or ranges, and `serverAddress` can limit which server address the client connects to:

```js
db.getSiblingDB("admin").createUser({user: "report", pwd: "report-pw",
  roles: [{role: "read", db: "reports"}],
  authenticationRestrictions: [{clientSource: ["172.30.0.21"]}]})
```

Logging in from client-a works and from client-b fails. The client again only sees Authentication failed, and even the error field of the `Failed to authenticate` log line just says Authentication failed. The real reason is in another log line just before it:

```
Failed to acquire user because of unmet authentication restrictions
reason: Evaluation of direct authentication restrictions failed:
        Restriction '{anyOf: [{allOf: [{"clientSource": ["172.30.0.21/32"]}]}]}' ... unmet
```

authenticationRestrictions can also be set on a role, and every user with that role inherits the restriction. Many people coming from MySQL don't know MongoDB has this, and assume firewalls and `bindIp` are the only way to control where connections come from.

## Authorization: GRANT and roles

MySQL 8.0 added roles, but a role granted to a user doesn't take effect by default:

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

The role is granted, but no role is active in the session. Roles can be activated at three levels. `SET ROLE` applies to the current session only, and a new session starts without a role again:

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

`SET DEFAULT ROLE 'app_read' TO 'bob'@'%'` applies to every future login of that account and does nothing for sessions already open. The global variable `activate_all_roles_on_login` applies to the whole instance: when it's on, every account activates all of its granted roles at login. MySQL has also always let you skip roles and grant privileges straight to a user, for example `GRANT INSERT ON shop.orders TO 'bob'@'%'`.

MongoDB is the other way around: privileges only live in roles, and users can only be given roles. `createUser` has no field for privileges at all:

```
> db.getSiblingDB("shop").createUser({user: "bob", pwd: "bob-pw", roles: [],
    privileges: [{resource: {db: "shop", collection: "orders"}, actions: ["find"]}]})
MongoServerError: BSON field 'createUser.privileges' is an unknown field.
```

So you create a custom role first. A privilege is a resource (a database, a collection or the whole cluster) plus a set of actions (find, insert, createIndex and so on):

```js
db.getSiblingDB("shop").createRole({role: "orderReader", roles: [],
  privileges: [{resource: {db: "shop", collection: "orders"}, actions: ["find"]}]})
db.getSiblingDB("shop").createUser({user: "bob", pwd: "bob-pw", roles: ["orderReader"]})
```

A granted role takes effect immediately; there's nothing to activate. bob can read orders, and reading customers is refused:

```
[client-a]$ mongosh "mongodb://bob:bob-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers.findOne()'
MongoServerError: not authorized on shop to execute command { find: "customers", filter: {}, limit: 1, ... }
```

MongoDB has no default role either. `roles` is a required field of createUser, and leaving it out is an error:

```
> db.getSiblingDB("shop").runCommand({createUser: "nobody", pwd: "nobody-pw"})
MongoServerError: BSON field 'createUser.roles' is missing but a required field
```

You can pass `roles: []` explicitly. Such a user can authenticate, but `authenticatedUserRoles` is empty, and it can't read data, list collections or even change its own password. It's roughly a new MySQL account with nothing but USAGE:

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

One more rule: a role created in a regular database can only have privileges on that database. Only roles created in admin can include privileges on other databases or on the cluster.

MongoDB's built-in roles map to MySQL roughly like this:

| MongoDB built-in role | Roughly the MySQL equivalent |
|---|---|
| read | `GRANT SELECT ON db.*` |
| readWrite | `GRANT SELECT, INSERT, UPDATE, DELETE ON db.*`, plus creating collections and indexes |
| dbAdmin | Database-level DDL, statistics and the profiler, but can't read application data |
| userAdmin | Creating users and roles and granting roles in that database |
| dbOwner | `GRANT ALL ON db.*`; includes the three above |
| readAnyDatabase, readWriteAnyDatabase and so on | The `ON *.*` versions |
| root | Close to MySQL's root |

On splitting up administrative privileges, MySQL 8.0 moved a step toward MongoDB. Administrative power used to sit in a single `SUPER` privilege; 8.0 split it into dynamic privileges grouped by function, such as `SYSTEM_VARIABLES_ADMIN` for changing system variables, `CONNECTION_ADMIN` for killing other users' connections and `BINLOG_ADMIN` for managing the binary log, and deprecated `SUPER`. Dynamic privileges can only be granted globally (`ON *.*`), they're stored in `mysql.global_grants`, and plugins and components can register their own:

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

The MongoDB counterparts are actions on the cluster resource, such as `setParameter`, `killop` and `replSetConfigure`. Dynamic and static privileges also differ in when changes take effect; the section on privilege changes below has the test.

Among the built-in roles, userAdmin deserves a note of its own. In MySQL, `WITH GRANT OPTION` only lets you pass on privileges you already have. MongoDB's userAdmin can grant any role in its database to any user, including itself:

```
[client-a]$ mongosh "mongodb://ua:ua-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.orders.findOne()'
MongoServerError: not authorized on shop to execute command { find: "orders", ... }

[client-a]$ mongosh "mongodb://ua:ua-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.grantRolesToUser("ua", ["dbOwner"]); db.orders.findOne()'
{ _id: 1, item: 'book' }
```

So userAdmin on a database effectively means full control of that database, and userAdminAnyDatabase in admin is effectively root on the whole cluster. Treat both as the highest level of privilege when you hand them out.

## Column privileges and views

MySQL privileges go down to the column:

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

Note that `SELECT *` touching a column you can't read gives the table-level error 1142; only naming that column explicitly gives the column-level 1143. Don't let it mislead you when troubleshooting.

MongoDB privileges stop at the collection; there are no field-level privileges. The usual way to hide fields from some users is to create a view and grant access only to the view:

```js
db.getSiblingDB("shop").createView("customers_public", "customers", [{$project: {phone: 0, email: 0}}])
db.getSiblingDB("shop").createRole({role: "publicReader", roles: [],
  privileges: [{resource: {db: "shop", collection: "customers_public"}, actions: ["find"]}]})
```

The user only needs find on the view, not on the underlying collection:

```
[client-a]$ mongosh "mongodb://carol:carol-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers_public.find().toArray()'
[ { _id: 1, name: 'Ann' } ]
[client-a]$ mongosh "mongodb://carol:carol-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'db.customers.find().toArray()'
MongoServerError: not authorized on shop to execute command { find: "customers", ... }
```

Views are read-only, so controlling writes field by field has to happen in the application. If the goal is to keep sensitive fields away from DBAs or anyone with access to the storage, that's a different problem, solved with Client-Side Field Level Encryption (CSFLE) or Queryable Encryption rather than privileges.

## When privilege changes take effect: FLUSH PRIVILEGES

Many MySQL tutorials follow every GRANT with `FLUSH PRIVILEGES`. It isn't needed. Account management statements such as GRANT, REVOKE, CREATE USER and ALTER USER update both the grant tables and the in-memory privilege cache, so they take effect at once:

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

`FLUSH PRIVILEGES` makes MySQL reload the privilege cache from the grant tables. You only need it when you bypass account management statements and change tables like mysql.user directly with INSERT, UPDATE or DELETE. For example, setting the account lock flag directly has no effect until the flush:

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

Sessions that are already open are easy to forget. The MySQL documentation sorts the rules into a few cases: table and column privilege changes take effect with the session's next statement; database privilege changes take effect at the next USE; static global privilege and password changes don't affect connected sessions until they reconnect; and dynamic global privilege changes take effect immediately. Static global privileges are the traditional ones such as `SELECT ON *.*`, `PROCESS` and `SUPER`; dynamic global privileges are the function-specific ones added in 8.0, such as `SESSION_VARIABLES_ADMIN`, `BACKUP_ADMIN` and `CONNECTION_ADMIN`. `SHOW PRIVILEGES` lists them all.

I set up one user for each case. Each opened a session, ran a statement, waited 4 seconds and ran it again, and at the 2-second mark I revoked their privilege:

| User | Revoked privilege | Second run in the same session |
|---|---|---|
| dave | Table level, `SELECT ON shop.orders` | Refused (1142) |
| hank | Database level, `SELECT ON shop.*`, session had run `USE shop` | Still works; refused only at the next `USE shop` (1044) |
| ivy | Database level, `SELECT ON shop.*`, session never ran USE | Refused (1142) |
| erin | Static global, `SELECT ON *.*` | Still works; only new sessions are refused |
| gina | Dynamic global, `SESSION_VARIABLES_ADMIN` | Refused (1227) |
| jack | An active role (holding `SELECT ON shop.*`) | Refused (1142) |

Comparing hank and ivy shows what "database privileges take effect at the next USE" means: it's about the session's current database. That database's privileges are cached in the session until it switches databases. A session that hasn't switched to the database is checked against the new privileges on its next statement. Here is hank's session:

```
[client-a]$ mysql -h mysql -u hank -p -N shop -e "SELECT 'before', COUNT(*) FROM orders; SELECT SLEEP(4) INTO @x; SELECT 'after', COUNT(*) FROM orders; USE shop; SELECT 'after USE', COUNT(*) FROM orders"
before  1
after   1
ERROR 1044 (42000) at line 1: Access denied for user 'hank'@'%' to database 'shop'
```

erin and gina show the difference between static and dynamic global privileges:

```
[client-a]$ mysql -h mysql -u erin -p -N -e "SELECT 'before', COUNT(*) FROM shop.orders; SELECT SLEEP(4) INTO @x; SELECT 'after', COUNT(*) FROM shop.orders"
before  1
after   1

[client-a]$ mysql -h mysql -u gina -p -N -e "SET SESSION sql_log_bin = 1; SELECT 'before: SET ok'; SELECT SLEEP(4) INTO @x; SET SESSION sql_log_bin = 1; SELECT 'after: SET ok'"
before: SET ok
ERROR 1227 (42000) at line 1: Access denied; you need (at least one of) the SUPER, SYSTEM_VARIABLES_ADMIN or SESSION_VARIABLES_ADMIN privilege(s) for this operation
```

So when you revoke a static global privilege or a database-level privilege and need it to take effect now, also kill that user's existing connections.

MongoDB has no FLUSH PRIVILEGES. Users and roles can only be changed with commands such as createUser and grantRolesToUser, and the change invalidates the user cache on every member. In a replica set, revoking a role also takes effect on connections that are already open. frank reads once, waits 4 seconds and reads again on the same connection, and his read role is revoked in between:

```
[client-a]$ mongosh "mongodb://frank:frank-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'print("before:", db.orders.countDocuments());
            sleep(4000);
            print("after:", db.orders.countDocuments())'
before: 1
MongoServerError: not authorized on shop to execute command { aggregate: "orders", ... }
```

MongoDB also has nothing like `SET ROLE`: every role granted to a user is always in effect, so there's no session versus global distinction. Even login restrictions apply to open connections. kim connected from client-b and read once; then I restricted kim to client-a, and the next read on the same connection was no longer authenticated:

```
[client-b]$ mongosh "mongodb://kim:kim-pw@mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" \
    --eval 'print("before:", db.orders.countDocuments());
            sleep(4000);
            print("after:", db.orders.countDocuments())'
before: 1
MongoServerError: Command aggregate requires authentication
```

The command at the 2-second mark was `db.getSiblingDB("shop").updateUser("kim", {authenticationRestrictions: [{clientSource: ["172.30.0.21"]}]})`. The matching server log line is `Removed user with unmet authentication restrictions from session cache of user information`: the user was removed from the connection. In MySQL you change an account's host with `RENAME USER`, and the host is only checked when a connection is made, so open sessions stay connected. I ran `RENAME USER 'lee'@'%' TO 'lee'@'172.30.0.21'` while lee had a session open from client-b. The session stayed connected, but the table privileges were renamed along with the account, so the next read failed with `ERROR 1142`, and a new session from client-b got `ERROR 1045`. Either way the user can no longer read the data; the difference is that MongoDB turns the connection back into an unauthenticated one, while the MySQL session survives without its privileges.

Sharded clusters are the exception. mongos caches user information too, and checks whether the cache is stale at the interval set by `userCacheInvalidationIntervalSecs` (30 seconds by default). A privilege changed through one mongos can therefore take up to 30 seconds to apply on the others. If you need it immediately, run `db.adminCommand({invalidateUserCache: 1})` on each mongos, which is probably the closest thing MongoDB has to FLUSH PRIVILEGES. I didn't reproduce this one in the lab; it's based on the documentation.

## The first user: the localhost exception

MySQL deals with the root password at initialization: `mysqld --initialize` generates a temporary password, and the Docker image requires `MYSQL_ROOT_PASSWORD` or an explicit choice of a random or empty password. Unless you deliberately create a root with an empty password using `--initialize-insecure`, MySQL has authentication on from day one.

MongoDB uses the localhost exception instead: when access control is on but no user exists yet, a connection from localhost may create the first user. On a replica set with keyfile authentication that hasn't been initiated:

```
[client-a]$ mongosh "mongodb://mongo1:27017/?directConnection=true" --eval 'rs.initiate()'
MongoServerError: Command replSetInitiate requires authentication

[mongo1]$ mongosh --eval 'rs.initiate({_id: "rs0", members: [
    {_id: 0, host: "mongo1:27017"}, {_id: 1, host: "mongo2:27017"}, {_id: 2, host: "mongo3:27017"}]}).ok'
1
```

A remote connection can't do anything. A local connection can initiate the replica set, but still can't read or write data:

```
[mongo1]$ mongosh --eval 'db.getSiblingDB("shop").orders.insertOne({item: "book"})'
MongoServerError: not authorized on shop to execute command { insert: "orders", ... }
```

What it can do is create the first user. The admin password is put in the PW environment variable beforehand, so it doesn't end up on the command line or in the shell history. As soon as the user exists, the exception closes and local connections have to authenticate too:

```
[mongo1]$ mongosh admin --eval 'db.createUser({user: "admin", pwd: process.env.PW, roles: ["root"]}).ok'
1
[mongo1]$ mongosh --eval 'db.getSiblingDB("admin").createUser({user: "second", pwd: "second-pw", roles: ["root"]})'
MongoServerError: Command createUser requires authentication
```

One more detail from the lab: after dropping the last user, the localhost exception doesn't reopen until mongod restarts. It looks like mongod remembers that users have existed and only checks again after a restart. If you don't want the exception at all, turn it off with the parameter `enableLocalhostAuthBypass=false`.

## Internal authentication: keyfile

MySQL replication uses an ordinary account. Replication itself only needs the `REPLICATION SLAVE` privilege; the replica uses that account to connect to the source and read the binary log. Many setups also grant `REPLICATION CLIENT`, which allows status statements such as `SHOW BINARY LOG STATUS` and `SHOW BINARY LOGS`. Monitoring and high-availability tools use it, but replication doesn't need it. The replication statements were renamed to SOURCE and REPLICA terms starting with 8.0.22, and in 8.4 old syntax like `SHOW SLAVE STATUS` is a syntax error. The privilege name never changed, though: `GRANT REPLICATION REPLICA` is a syntax error in both 8.0 and 8.4.

MongoDB replica set members don't use application accounts. They use internal authentication, most commonly a keyfile: every member holds the same key file and starts with `--keyFile`. In the server log, authentication between members looks like this:

```
"msg":"Successfully authenticated","attr":{"client":"172.30.0.13:32994","isClusterMember":true,
  "mechanism":"SCRAM-SHA-256","user":"__system","db":"local",...}
```

Members authenticate to each other as the built-in `__system@local` user with SCRAM-SHA-256, using a password derived from the keyfile. Two things to note. First, enabling internal authentication also enables client authorization; in the documentation's words, "Enabling internal authentication also enables client authorization", so you don't need to set `security.authorization` separately. That holds for both keyfile and x509 internal authentication, the exception being the transitional `--transitionToAuth`, covered below. Second, the keyfile must not be readable by other users, or mongod refuses to start.

The other form of internal authentication is x509 certificates. x509 has two uses in MongoDB: clients logging in with certificates, and members authenticating to each other with certificates. The first is rare in self-managed deployments. The second is the configuration MongoDB recommends for production, although plenty of teams still use keyfiles. Also keep in mind that TLS encryption in transit is not x509 authentication; many clusters run TLS and still authenticate with passwords.

## Enabling authentication on a running replica set

MongoDB doesn't enable access control by default. On a replica set without it, anyone who can reach the port can do anything:

```
[client-b]$ mongosh "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/?replicaSet=rs0" \
    --eval 'db.getSiblingDB("admin").runCommand({listDatabases: 1}).databases.map(d => d.name)'
[ 'admin', 'config', 'local' ]
```

MySQL doesn't have this problem, so it has no equivalent procedure. To turn on authentication for a running MongoDB replica set without downtime, you use `--transitionToAuth` in three steps:

1. While authentication is still off, create the admin and application users. They exist but aren't enforced yet.
2. Restart the members one at a time with `--keyFile --transitionToAuth`, secondaries first, then step down the primary and restart it. In transitionToAuth mode, members authenticate to each other with the keyfile, and clients can connect with or without credentials.
3. Switch every client to connect with credentials, then restart the members one at a time again with only `--keyFile`.

To see the effect on applications, I ran two writers on client-a, each inserting about 10 documents a second, one without credentials and one as the app user. Writes per phase:

| Phase | Writer without credentials | Writer with credentials |
|---|---|---|
| Authentication off | 50 ok, 0 failed | 50 ok, 0 failed |
| Step 2: rolling to transitionToAuth | 534 ok, 0 failed | 534 ok, 0 failed |
| Step 3: rolling to keyFile | 353 ok, 225 failed | 563 ok, 0 failed |

The writer with credentials never failed once; retryable writes covered the primary stepdowns. The writer without credentials stands for a client someone forgot to update, and it started failing once the primary switched to keyFile mode:

```
Command insert requires authentication
```

Why not skip step 2? I restarted one secondary straight from no authentication to `--keyFile` and checked the replica set 20 seconds later:

```
mongo1:27017  PRIMARY  health=1
mongo2:27017  (not reachable/healthy)  health=0
mongo3:27017  SECONDARY  health=1
```

That member requires the others to authenticate, and they have no keyfile; when it connects to them, they don't recognize its authentication either. transitionToAuth exists so that members accept both kinds of connection during the transition.

## Rotating the keyfile

Keyfiles need rotating eventually, but every member must still be able to authenticate to the others, so you can't swap them all at once. Since MongoDB 4.2, a keyfile can be a YAML list holding several keys:

```yaml
- <old key>
- <new key>
```

Rotation takes two rounds: first restart the members one at a time with a keyfile holding both the old and the new key; when all are done, restart them one at a time again with a keyfile holding only the new key. In the lab, the replica set stayed healthy through both rounds and the primary switched over normally.

As before, if you skip the first round and give one member only the new key, it loses contact with the others and shows up as `(not reachable/healthy)`, just like in the previous section.

## Sharded clusters: where users live

A sharded cluster has two sets of users. Users created through mongos are cluster users, stored on the config servers:

```
mongos> db.getSiblingDB("admin").createUser({user: "analyst", pwd: "analyst-pw",
          roles: [{role: "read", db: "sales"}]})
mongos> db.getSiblingDB("admin").system.users.find({}, {_id: 1}).toArray()
[ { _id: 'admin.admin' }, { _id: 'admin.analyst' } ]
```

Access through mongos works, but the user doesn't exist on the shards, so a direct connection to a shard fails, and the shard's log says UserNotFound:

```
[client-a]$ mongosh "mongodb://analyst:analyst-pw@shard1:27017/sales?authSource=admin&directConnection=true" \
    --eval 'db.orders.countDocuments()'
MongoServerError: Authentication failed.
error: UserNotFound: Could not find user "analyst" for db "admin"
```

The bigger issue is that the shard has no users of its own, so its localhost exception is still open. Anyone who can log in to the shard's host can create a root user there:

```
[shard1]$ mongosh admin --eval 'db.createUser({user: "shardadmin", pwd: "shardadmin-pw", roles: ["root"]}).ok'
1
```

This shard-local user exists only on shard1; mongos doesn't know it, and authenticating to mongos with it fails. MongoDB recommends creating a shard-local admin user on every shard, both for maintenance over direct connections and to close the localhost exception on the shard.

## Troubleshooting checklist

When you hit an access control problem, find the symptom in this table:

| Symptom | Look at | Common cause |
|---|---|---|
| MongoDB says Authentication failed | The error field of the `Failed to authenticate` server log line | UserNotFound: wrong authSource; storedKey mismatch: wrong password |
| Same, but the error only says Authentication failed | A log line with `unmet authentication restrictions` | The client IP isn't in clientSource |
| Authentication failed, but you don't know which application | The connection id `connNNN` on the failure line, then the `client metadata` line of the same connection | `application.name` identifies the application, provided it sets appName |
| MongoDB says not authorized on <database> to execute command | `db.runCommand({connectionStatus: 1, showPrivileges: true})` | The role lacks this action or resource |
| MySQL error 1142 even though the role is granted | `SELECT CURRENT_ROLE()` | The role isn't active |
| A replica set member is not reachable/healthy | That member's log | Keyfiles don't match between members, or members are in different auth modes |
| Lots of Checking authorization failed in the log for an atlascli aggregation | Safe to ignore | mongosh runs this probe in the background after connecting; users with limited privileges leave this line |

## Quick reference

| Topic | MySQL | MongoDB |
|---|---|---|
| Account identity | `'user'@'host'` | User name + authentication database |
| What the client specifies | User name only | User name + authSource; defaults to the database in the URI path, or admin if there is none |
| Restricting the client source | The host part of the account | `authenticationRestrictions.clientSource` |
| Granting privileges | Directly to users, or through roles | Through roles only |
| Roles taking effect | Must be activated: `SET ROLE` (current session), `SET DEFAULT ROLE` (future logins of the account) or `activate_all_roles_on_login` (whole instance) | Immediately when granted |
| Finest granularity | Column | Collection; fields via views |
| Privilege changes take effect | Account management statements apply immediately; direct edits to the grant tables need FLUSH PRIVILEGES; static global privileges and the current database's privileges don't affect open sessions | Immediately, including open connections; mongos user cache up to 30 seconds by default |
| First administrator | Root password set at initialization | The localhost exception |
| Authentication on by default | Yes | No |
| Replication or member authentication | Ordinary account + REPLICATION SLAVE (REPLICATION CLIENT for status, not required) | Keyfile or x509, as `__system` |
| Enabling authentication without downtime | Not applicable | `--transitionToAuth` in three steps |
| Sharded clusters | Not applicable | mongos users live on the config servers; shards have their own local users |
