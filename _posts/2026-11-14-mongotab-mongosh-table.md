---
layout: post
title: "MongoTab：让 mongosh 的输出像 MySQL 一样好读"
date: 2026-11-14
permalink: /posts/2026/11/mongotab-mongosh-table/
lang: zh-CN
ref: mongotab-mongosh-table
category: MongoDB
tags: [MongoDB, mongosh, MySQL, DBA, 工具]
description: "MongoTab 是一个只有一个 JS 文件的 mongosh 小工具，把查询结果排成 MySQL 风格的表格和 \\G 竖排。这篇讲它解决什么问题、怎么用，以及几个设计上的取舍：不改 mongosh 本身、区分 null 和字段不存在、BSON 类型的显示方式、大文档拆子表。"
imagefeature: cover4.jpg
comments: true
featured: true
toc: true
---
从 MySQL 转到 MongoDB 做运维，最先不习惯的往往不是命令，而是输出。在 MySQL 里看主从状态，`SHOW SLAVE STATUS\G` 一屏就能找到 `Seconds_Behind_Master`；看连接，`SHOW PROCESSLIST` 是一张表。到了 mongosh，`rs.status()` 返回的是一个嵌套了好几层的文档，3 个节点的副本集就有 139 行，想知道每个节点是什么状态、从哪个节点同步，要上下翻着找。

我给自己写了一个小工具 MongoTab，在 mongosh 里把结果排成 MySQL 风格的表格，或者像 `\G` 那样竖排。它只有一个 JS 文件，没有依赖，代码和说明在 GitHub 上：[mongosh-table](https://github.com/yinx0004/mongosh-table)。

文中的例子都是在实验环境里实际跑出来的：mongosh 2.3.8，MongoDB 8.0.4 三节点副本集，数据是一套模拟的电商订单。

## 先看效果

这是 mongosh 默认输出的 `rs.status()`，一共 139 行：

```
rs0 [primary] shop> rs.status()
{
  set: 'rs0',
  date: ISODate('2026-11-14T14:48:12.315Z'),
  myState: 1,
  term: Long('2'),
  syncSourceHost: '',
  syncSourceId: -1,
  heartbeatIntervalMillis: Long('2000'),
  majorityVoteCount: 2,
  writeMajorityCount: 2,
  votingMembersCount: 3,
  writableVotingMembersCount: 3,
  optimes: {
    lastCommittedOpTime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
    lastCommittedWallTime: ISODate('2026-11-14T14:48:06.771Z'),
    readConcernMajorityOpTime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
    appliedOpTime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
    durableOpTime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
    writtenOpTime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
    lastAppliedWallTime: ISODate('2026-11-14T14:48:06.771Z'),
    lastDurableWallTime: ISODate('2026-11-14T14:48:06.771Z'),
    lastWrittenWallTime: ISODate('2026-11-14T14:48:06.771Z')
  },
  lastStableRecoveryTimestamp: Timestamp({ t: 1794667652, i: 2 }),
  electionCandidateMetrics: {
    lastElectionReason: 'priorityTakeover',
    lastElectionDate: ISODate('2026-11-14T14:46:56.650Z'),
    electionTerm: Long('2'),
    lastCommittedOpTimeAtElection: { ts: Timestamp({ t: 1794667605, i: 16 }), t: Long('1') },
    lastSeenWrittenOpTimeAtElection: { ts: Timestamp({ t: 1794667605, i: 16 }), t: Long('1') },
    lastSeenOpTimeAtElection: { ts: Timestamp({ t: 1794667605, i: 16 }), t: Long('1') },
    numVotesNeeded: 2,
    priorityAtElection: 2,
    electionTimeoutMillis: Long('10000'),
    priorPrimaryMemberId: 2,
    numCatchUpOps: Long('0'),
    newTermStartDate: ISODate('2026-11-14T14:46:56.753Z'),
    wMajorityWriteAvailabilityDate: ISODate('2026-11-14T14:46:56.763Z')
  },
  electionParticipantMetrics: {
    votedForCandidate: true,
    electionTerm: Long('1'),
    lastVoteDate: ISODate('2026-11-14T14:46:45.570Z'),
    electionCandidateMemberId: 2,
    voteReason: '',
    lastWrittenOpTimeAtElection: { ts: Timestamp({ t: 1794667594, i: 1 }), t: Long('-1') },
    maxWrittenOpTimeInSet: { ts: Timestamp({ t: 1794667594, i: 1 }), t: Long('-1') },
    lastAppliedOpTimeAtElection: { ts: Timestamp({ t: 1794667594, i: 1 }), t: Long('-1') },
    maxAppliedOpTimeInSet: { ts: Timestamp({ t: 1794667594, i: 1 }), t: Long('-1') },
    priorityAtElection: 2
  },
  members: [
    {
      _id: 0,
      name: 'mongo1:27017',
      health: 1,
      state: 1,
      stateStr: 'PRIMARY',
      uptime: 106,
      optime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeDate: ISODate('2026-11-14T14:48:06.000Z'),
      optimeWritten: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeWrittenDate: ISODate('2026-11-14T14:48:06.000Z'),
      lastAppliedWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastDurableWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastWrittenWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      syncSourceHost: '',
      syncSourceId: -1,
      infoMessage: '',
      electionTime: Timestamp({ t: 1794667616, i: 1 }),
      electionDate: ISODate('2026-11-14T14:46:56.000Z'),
      configVersion: 1,
      configTerm: 2,
      self: true,
      lastHeartbeatMessage: ''
    },
    {
      _id: 1,
      name: 'mongo2:27017',
      health: 1,
      state: 2,
      stateStr: 'SECONDARY',
      uptime: 97,
      optime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeDurable: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeWritten: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeDate: ISODate('2026-11-14T14:48:06.000Z'),
      optimeDurableDate: ISODate('2026-11-14T14:48:06.000Z'),
      optimeWrittenDate: ISODate('2026-11-14T14:48:06.000Z'),
      lastAppliedWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastDurableWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastWrittenWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastHeartbeat: ISODate('2026-11-14T14:48:10.840Z'),
      lastHeartbeatRecv: ISODate('2026-11-14T14:48:10.832Z'),
      pingMs: Long('0'),
      lastHeartbeatMessage: '',
      syncSourceHost: 'mongo3:27017',
      syncSourceId: 2,
      infoMessage: '',
      configVersion: 1,
      configTerm: 2
    },
    {
      _id: 2,
      name: 'mongo3:27017',
      health: 1,
      state: 2,
      stateStr: 'SECONDARY',
      uptime: 97,
      optime: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeDurable: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeWritten: { ts: Timestamp({ t: 1794667686, i: 1 }), t: Long('2') },
      optimeDate: ISODate('2026-11-14T14:48:06.000Z'),
      optimeDurableDate: ISODate('2026-11-14T14:48:06.000Z'),
      optimeWrittenDate: ISODate('2026-11-14T14:48:06.000Z'),
      lastAppliedWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastDurableWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastWrittenWallTime: ISODate('2026-11-14T14:48:06.771Z'),
      lastHeartbeat: ISODate('2026-11-14T14:48:10.921Z'),
      lastHeartbeatRecv: ISODate('2026-11-14T14:48:11.356Z'),
      pingMs: Long('0'),
      lastHeartbeatMessage: '',
      syncSourceHost: 'mongo1:27017',
      syncSourceId: 0,
      infoMessage: '',
      configVersion: 1,
      configTerm: 2
    }
  ],
  ok: 1,
  '$clusterTime': {
    clusterTime: Timestamp({ t: 1794667686, i: 1 }),
    signature: {
      hash: Binary.createFromBase64('AAAAAAAAAAAAAAAAAAAAAAAAAAA=', 0),
      keyId: Long('0')
    }
  },
  operationTime: Timestamp({ t: 1794667686, i: 1 })
}
```

加载 MongoTab 以后，只挑需要的几列（这次执行比上面晚了十来秒，所以时间不一样）：

```
rs0 [primary] shop> t(rs.status(), 'set,myState,members.name,members.stateStr,members.health,members.optimeDate,members.syncSourceHost')
    set: rs0
myState: 1

── members (3) ──
+--------------+-----------+--------+---------------------+----------------+
| name         | stateStr  | health | optimeDate          | syncSourceHost |
+--------------+-----------+--------+---------------------+----------------+
| mongo1:27017 | PRIMARY   |      1 | 2026-11-14 14:48:16 |                |
| mongo2:27017 | SECONDARY |      1 | 2026-11-14 14:48:16 | mongo3:27017   |
| mongo3:27017 | SECONDARY |      1 | 2026-11-14 14:48:16 | mongo1:27017   |
+--------------+-----------+--------+---------------------+----------------+
3 rows in set
```

一眼就能看出 mongo1 是主节点，mongo2 从 mongo3 同步，mongo3 从 mongo1 同步，三个节点的 optime 一样，没有延迟。

## 怎么用

先把 `mongotab.js` 下载到跳板机上。已经连上 mongosh 时，用 `load` 加载：

```js
load('/path/to/mongotab.js')
```

也可以在连接时一起加载，`--shell` 表示执行完文件后留在交互界面：

```bash
mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

提示信息跟随系统语言，也可以用环境变量 `MONGOTAB_LANG=zh` 或 `en` 指定，文中的例子用的是中文。加载后有三个函数：`t` 输出表格，`g` 竖排输出（相当于 MySQL 的 `\G`），`mt` 放其他功能。常用的写法：

```js
t(db.orders.find({status: 'paid'}))              // 表格，太宽时自动改成竖排
g(db.orders.findOne())                            // 竖排
t(db.orders.find(), 'orderNo,customer,amount')    // 只看这几列，customer 表示 customer 下的所有字段
t(db.orders.find(), {exclude: 'items,raw.*'})     // 排除某些列
t(db.orders.find(), {limit: 200})                 // 默认最多显示 50 行
t(db.orders.find(), {tz: '+08:00'})               // 这一次按东八区显示时间
mt.csv(db.orders.find(), 'orderNo,amount')        // 输出 CSV，可以直接贴进 Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})      // 修改本次会话的默认设置
mt.help()
```

### 导出 CSV

要把结果发给别人，或者贴进 Excel 再加工，用 `mt.csv`。参数和 `t` 一样，可以选列：

```
rs0 [primary] shop> mt.csv(db.mt_demo.find(), 'orderNo,customer.name,amount,createdAt,remark')
orderNo,customer.name,amount,createdAt,remark
SO20240101001,张三,1299.50,2024-01-01 08:30:00,"加急
周末送达"
SO20240101002,Alice,88.00,2024-01-01 09:00:00,NULL
```

和表格有两点不同。第一，字符串里的换行在表格里显示成 `\n`，在 CSV 里保留原样，用双引号把整个值括起来，这是 CSV 的标准写法，Excel 打开后还是一个单元格里的两行。第二，CSV 不截断长内容。时间、数字、null 和字段不存在的显示方式和表格一致：

```
rs0 [primary] shop> mt.csv(db.orders.find({_id: {$gte: 6, $lte: 9}}), '_id,status,amount,region')
_id,status,amount,region
6,shipped,2.22,apac
7,delivered,2.59,(无字段)
8,cancelled,2.96,NULL
9,refunded,3.33,apac
```

## 设计上的几个取舍

### 不改 mongosh 本身

线上排障一般是 ssh 到跳板机上用 mongosh，这台机器往往是几个人共用的，很多人对"装个东西会不会影响我的会话"很敏感。所以 MongoTab 只往全局加了 `t`、`g`、`mt` 三个函数，外加一个 `mongotab` 对象，不改 mongosh 自带的任何对象和 prototype，不写 `.mongoshrc.js`，退出会话就失效了。

如果 `t` 这个名字已经被占用，比如自己定义过变量 `t`，MongoTab 不会覆盖它，而是跳过并给出提示，这时改用 `mongotab.table`：

```
rs0 [primary] shop> var t = 1
rs0 [primary] shop> load('/tmp/mongotab.js')
MongoTab 0.1.0 已加载：t(x) 表格 / g(x) 竖排 / mt.help()   时区 UTC
  注意：t 已被占用，未覆盖；请用 mongotab.table / mongotab.vertical / mongotab.help()
rs0 [primary] shop> mongotab.table(db.mt_demo.find(), 'orderNo,amount')
+---------------+---------+
| orderNo       | amount  |
+---------------+---------+
| SO20240101001 | 1299.50 |
| SO20240101002 |   88.00 |
+---------------+---------+
2 rows in set
```

### 区分 null 和字段不存在

MySQL 里一列要么有值，要么是 NULL。MongoDB 多了一种情况：文档里根本没有这个字段。实验数据里，订单 7 没有 region 字段，订单 8 的 region 是 null。mongosh 默认的输出里，要逐个看字段名才能发现：

```
rs0 [primary] shop> db.orders.find({_id: {$gte: 7, $lte: 8}}, {items: 0})
[
  {
    _id: 7,
    customer_id: 5434,
    status: 'delivered',
    amount: 2.59,
    created_at: ISODate('2026-01-01T00:01:31.000Z'),
    customer_tier: 'silver'
  },
  {
    _id: 8,
    customer_id: 13353,
    status: 'cancelled',
    amount: 2.96,
    created_at: ISODate('2026-01-01T00:01:44.000Z'),
    region: null,
    customer_tier: 'gold'
  }
]
```

排成表格后，三种情况分开显示：值为 null 显示 `NULL`，字段不存在显示 `(无字段)`（在终端里是暗色的，英文环境下是 `(missing)`），空字符串显示为空白，和 MySQL 一样：

```
rs0 [primary] shop> t(db.orders.find({_id: {$gte: 6, $lte: 9}}), '_id,region')
+-----+----------+
| _id | region   |
+-----+----------+
|   6 | apac     |
|   7 | (无字段) |
|   8 | NULL     |
|   9 | apac     |
+-----+----------+
4 rows in set
```

空字符串的例子在前面 `rs.status()` 的表格里：主节点的 `syncSourceHost` 是空字符串 `''`，所以那一格是空白。

竖排时，不存在的字段直接不显示，订单 7 的竖排里就没有 region 这一行。`mt.csv` 的规则和表格一样，前面导出 CSV 的例子里，订单 7 和 8 分别是 `(无字段)` 和 `NULL`，贴进 Excel 后是普通文字，不会和空单元格混在一起。

这个区别在查询时很重要：`{region: null}` 既能匹配值为 null 的文档，也能匹配没有这个字段的文档，上面这 4 个订单里它会查出 7 和 8 两个。只想要字段不存在的，用 `{region: {$exists: false}}`；只想要值为 null 的，用 `{region: {$type: 'null'}}`。

### BSON 类型按 DBA 习惯显示

mongosh 默认把 BSON 类型连同类型名一起打出来，比如 `ObjectId('...')`、`Decimal128('1299.50')`、`Long('3')`，表格里这些包装会把列撑得很宽。MongoTab 的处理：

| BSON 类型 | 显示 |
|---|---|
| ObjectId | 十六进制字符串 |
| Date | `2024-01-01 08:30:00`，默认 UTC，可以指定时区 |
| Long、Int32、Double、Decimal128 | 数字，右对齐 |
| Timestamp | 时间加上原始值，比如 `2026-11-14 14:47:56 (1794667676:1)` |
| UUID | UUID 字符串 |
| 字符串里的换行、制表符 | 显示成 `\n`、`\t`，保证一行一条记录 |

Timestamp 同时显示时间和原始值，是因为 oplog 的位置就是一个 Timestamp，比较两个节点的复制进度时要看后面的 `秒:序号`，只显示时间会丢掉序号。比如看各节点的 optime：

```
rs0 [primary] shop> t(rs.status(), 'set,term,optimes.lastCommittedOpTime.ts,members.name,members.stateStr,members.optime.ts,members.optimeDate')
                           set: rs0
                          term: 2
optimes.lastCommittedOpTime.ts: 2026-11-14 14:47:56 (1794667676:1)

── members (3) ──
+--------------+-----------+------------------------------------+---------------------+
| name         | stateStr  | optime.ts                          | optimeDate          |
+--------------+-----------+------------------------------------+---------------------+
| mongo1:27017 | PRIMARY   | 2026-11-14 14:47:56 (1794667676:1) | 2026-11-14 14:47:56 |
| mongo2:27017 | SECONDARY | 2026-11-14 14:47:56 (1794667676:1) | 2026-11-14 14:47:56 |
| mongo3:27017 | SECONDARY | 2026-11-14 14:47:56 (1794667676:1) | 2026-11-14 14:47:56 |
+--------------+-----------+------------------------------------+---------------------+
3 rows in set
```

时间默认按 UTC 显示，这样和日志里的时间对得上。习惯看本地时间的话，可以加 `{tz: '+08:00'}`，或者在启动前设置环境变量 `MONGOTAB_TZ=+08:00`：

```
rs0 [primary] shop> t(db.mt_demo.find(), {tz: '+08:00', exclude: 'remark'})
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+
| _id                      | orderNo       | customer.name | customer.level | amount  | qty | createdAt           |
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+
| 6571a2b3c4d5e6f708192a3b | SO20240101001 | 张三          | gold           | 1299.50 |   3 | 2024-01-01 16:30:00 |
| 6571a2b3c4d5e6f708192a3c | SO20240101002 | Alice         | silver         |   88.00 |  12 | 2024-01-01 17:00:00 |
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+
2 rows in set
```

这张表还能看到另外两点：嵌套的 customer 文档被展开成 `customer.name`、`customer.level` 两列；中文按两个字符宽计算，在终端里"张三"和"Alice"所在的列是对齐的。网页上的等宽字体里，一个汉字不一定正好是两个英文字符宽，所以这张表在网页上看可能会错开一点。

### 大文档竖排，文档数组拆成子表

`rs.status()`、`db.serverStatus()` 这类命令返回的是一个大文档，排成一行的表格没有意义。传给 `t` 的是单个文档时，MongoTab 先竖排列出普通字段；文档里的"文档数组"，比如 `rs.status()` 的 `members`，单独排成一张子表，前面那几个例子就是这样。

选列时可以直接写到子表里的字段，`members.name` 表示子表里的 name 列。订单文档也一样，订单里的明细数组会变成子表：

```
rs0 [primary] shop> g(db.orders.findOne({_id: 3002}))
          _id: 3002
  customer_id: 22839
       status: delivered
       amount: 110.74
   created_at: 2026-01-01 10:50:26
       region: amer
customer_tier: gold

── items (3) ──
*************************** 1. row ***************************
     sku: sku-62
sku_name: Product 62
     qty: 3
   price: 10.14
*************************** 2. row ***************************
     sku: sku-79
sku_name: Product 79
     qty: 4
   price: 10.25
*************************** 3. row ***************************
     sku: sku-96
sku_name: Product 96
     qty: 1
   price: 10.36
3 rows in set
```

### 太宽时自动竖排

字段一多，表格就会比终端还宽，换行以后反而更难看。`t` 会先按表格排一遍，如果总宽度超过终端宽度，就自动改成竖排。上面那张订单表加上 remark 列以后，宽度超过了 120 列的终端，输出变成了：

```
rs0 [primary] shop> t(db.mt_demo.find())
*************************** 1. row ***************************
           _id: 6571a2b3c4d5e6f708192a3b
       orderNo: SO20240101001
 customer.name: 张三
customer.level: gold
        amount: 1299.50
           qty: 3
     createdAt: 2024-01-01 08:30:00
        remark: 加急\n周末送达
*************************** 2. row ***************************
           _id: 6571a2b3c4d5e6f708192a3c
       orderNo: SO20240101002
 customer.name: Alice
customer.level: silver
        amount: 88.00
           qty: 12
     createdAt: 2024-01-01 09:00:00
        remark: NULL
2 rows in set
```

一定要表格时加 `{table: true}`。单元格超过 40 个字符会截断成 `...`，竖排时不截断。

### 默认只取 50 行

传进去的是游标时，MongoTab 只从游标里取前 50 行，不会把整个结果集拉到 mongosh 里再截断。还有更多数据时，最后一行会提示怎么看更多，比如 `t(x, {limit: 200})`。在线上对一个大集合随手 `t(db.orders.find())`，不会因为结果太多把跳板机的内存占满。

## 和现有办法比

mongosh 本身也有几种办法让输出好读一些，用同一个集合对比一下。

### console.table

mongosh 是基于 Node.js 的，可以直接用 `console.table`：

```
rs0 [primary] shop> console.table(db.mt_demo.find().toArray())
┌─────────┬──────────────────────────────────────┬─────────────────┬────────────────────────────────────┬───────────────────────┬────────────┬──────────────────────────┬──────────────────┐
│ (index) │ _id                                  │ orderNo         │ customer                           │ amount                │ qty        │ createdAt                │ remark           │
├─────────┼──────────────────────────────────────┼─────────────────┼────────────────────────────────────┼───────────────────────┼────────────┼──────────────────────────┼──────────────────┤
│ 0       │ ObjectId('6571a2b3c4d5e6f708192a3b') │ 'SO20240101001' │ { name: '张三', level: 'gold' }    │ Decimal128('1299.50') │ Long('3')  │ 2024-01-01T08:30:00.000Z │ '加急\n周末送达' │
│ 1       │ ObjectId('6571a2b3c4d5e6f708192a3c') │ 'SO20240101002' │ { name: 'Alice', level: 'silver' } │ Decimal128('88.00')   │ Long('12') │ 2024-01-01T09:00:00.000Z │ null             │
└─────────┴──────────────────────────────────────┴─────────────────┴────────────────────────────────────┴───────────────────────┴────────────┴──────────────────────────┴──────────────────┘
```

同样的数据用 MongoTab。这次终端是 160 列宽，放得下，所以输出的是表格；前面"太宽时自动竖排"里同一条命令在 120 列的终端里变成了竖排：

```
rs0 [primary] shop> t(db.mt_demo.find())
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+----------------+
| _id                      | orderNo       | customer.name | customer.level | amount  | qty | createdAt           | remark         |
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+----------------+
| 6571a2b3c4d5e6f708192a3b | SO20240101001 | 张三          | gold           | 1299.50 |   3 | 2024-01-01 08:30:00 | 加急\n周末送达 |
| 6571a2b3c4d5e6f708192a3c | SO20240101002 | Alice         | silver         |   88.00 |  12 | 2024-01-01 09:00:00 | NULL           |
+--------------------------+---------------+---------------+----------------+---------+-----+---------------------+----------------+
2 rows in set
```

`console.table` 能用，中文也能对齐，字段不存在时同样留空。区别在于：BSON 类型带着 `ObjectId(...)`、`Decimal128(...)`、`Long(...)` 这些包装，列被撑宽了；嵌套的 customer 文档整个塞在一个单元格里；字符串带引号，数字左对齐。另外它要先 `.toArray()`，会把整个结果集取到客户端。

`console.table` 也能指定列，但只认顶层字段，写嵌套路径时那一列是空的：

```
rs0 [primary] shop> console.table(db.mt_demo.find().toArray(), ['orderNo', 'customer.name', 'amount'])
┌─────────┬─────────────────┬───────────────┬───────────────────────┐
│ (index) │ orderNo         │ customer.name │ amount                │
├─────────┼─────────────────┼───────────────┼───────────────────────┤
│ 0       │ 'SO20240101001' │               │ Decimal128('1299.50') │
│ 1       │ 'SO20240101002' │               │ Decimal128('88.00')   │
└─────────┴─────────────────┴───────────────┴───────────────────────┘
```

它也没有竖排，遇到 `rs.status()` 这种大文档没什么帮助。

### --json 加 jq

`mongosh --json=relaxed --eval '...'` 会把结果输出成标准的 Extended JSON：

```
$ mongosh --quiet --json=relaxed "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" --eval 'db.mt_demo.find({orderNo: "SO20240101001"}).toArray()'
[
  {
    "_id": {
      "$oid": "6571a2b3c4d5e6f708192a3b"
    },
    "orderNo": "SO20240101001",
    "customer": {
      "name": "张三",
      "level": "gold"
    },
    "amount": {
      "$numberDecimal": "1299.50"
    },
    "qty": 3,
    "createdAt": {
      "$date": "2024-01-01T08:30:00Z"
    },
    "remark": "加急\n周末送达"
  }
]
```

再交给 `jq` 取字段，适合写进脚本：

```
$ mongosh --quiet --json=relaxed "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" --eval 'db.mt_demo.find().toArray()' | jq -r '.[] | [.orderNo, .customer.name, .amount."$numberDecimal"] | @tsv'
SO20240101001	张三	1299.50
SO20240101002	Alice	88.00
```

这种方式结果准确、方便自动化，但每看一次都要写一段 jq，而且要注意 Decimal128 这类类型在 JSON 里是 `{"$numberDecimal": ...}` 这样的结构，不适合交互式排障时随手看。

### 图形工具

Compass 这类图形工具功能最全，但线上环境往往只能 ssh 到跳板机，用不了图形界面。

MongoTab 针对的就是这种场景：只有一个 mongosh 终端，要快速看清楚结果。

## DBA 常用命令对照

| MySQL 习惯 | mongosh + MongoTab |
|---|---|
| `SHOW PROCESSLIST` | `t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')` |
| `SHOW SLAVE STATUS` | `t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost,lastHeartbeat')` |
| `SHOW DATABASES` | `t(db.adminCommand({listDatabases: 1}).databases)` |
| `SHOW INDEX FROM t` | `t(db.orders.getIndexes())` |
| `SHOW GLOBAL STATUS` | `t(db.serverStatus(), 'connections,opcounters,mem')` |

比如用 `currentOp` 找一条正在跑的慢查询。`currentOp` 的每条记录有 30 个字段，默认输出好几十行，挑几列就清楚了：

```
rs0 [primary] shop> t(db.currentOp({active: true, ns: 'shop.orders'}).inprog, 'opid,secs_running,op,ns,client,appName,planSummary')
+--------+--------------+---------+-------------+--------------------+------------+-------------+
| opid   | secs_running | op      | ns          | client             | appName    | planSummary |
+--------+--------------+---------+-------------+--------------------+------------+-------------+
| 392195 |            1 | getmore | shop.orders | 192.168.97.3:56612 | report-job | COLLSCAN    |
+--------+--------------+---------+-------------+--------------------+------------+-------------+
1 row in set
```

`appName` 是客户端在连接串里填的应用名，`planSummary` 是 `COLLSCAN`，说明这条查询在做全集合扫描。确认要停掉的话，用 `db.killOp(392195)`。

MySQL 的命令怎么对应到 MongoDB，我另外整理了一个查询页面：[DBA Command Finder](https://www.solidstack.io/dba-command-finder/)。

## 最后

MongoTab 只负责显示，查询本身照常执行，不会改变返回的结果，也不会改变查询走什么执行计划。它目前是 0.1.0 版本，用起来有问题或者有想法，欢迎在 GitHub 上提 issue。
