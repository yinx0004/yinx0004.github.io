---
layout: post
title: "MongoTab: MySQL-Style Table Output for mongosh"
date: 2026-11-14
permalink: /posts/2026/11/mongotab-mysql-style-tables-for-mongosh/
lang: en
ref: mongotab-mongosh-table
category: MongoDB
tags: [MongoDB, mongosh, MySQL, DBA, Tools]
description: "MongoTab is a single-file mongosh helper that prints query results as MySQL-style tables or \\G-style vertical output. What it is for, how to use it, and the design choices behind it: no changes to mongosh itself, null vs missing fields, how BSON types are shown, and sub-tables for large documents."
imagefeature: cover4.jpg
comments: true
featured: true
toc: true
---
When you move from MySQL to MongoDB operations, the commands are rarely what slows you down. The output is. In MySQL, `SHOW SLAVE STATUS\G` puts `Seconds_Behind_Master` on one screen, and `SHOW PROCESSLIST` is a table. In mongosh, `rs.status()` returns a document nested several levels deep: 139 lines for a three-member replica set. To see each member's state and where it syncs from, you scroll up and down looking for the right fields.

I wrote a small tool for myself, MongoTab. It prints results in mongosh as MySQL-style tables, or vertically like `\G`. It's a single JS file with no dependencies, and the code and docs are on GitHub: [mongosh-table](https://github.com/yinx0004/mongosh-table).

Every example in this post comes from a lab: mongosh 2.3.8 against a three-member MongoDB 8.0.4 replica set, with synthetic e-commerce orders as the data.

## What it looks like

This is the default mongosh output of `rs.status()`, all 139 lines:

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

With MongoTab loaded, picking just the columns you need (this ran about ten seconds later, so the times differ):

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

At a glance: mongo1 is the primary, mongo2 syncs from mongo3, mongo3 syncs from mongo1, and all three members have the same optime, so there is no lag.

## How to use it

Download `mongotab.js` to the jump host. If you're already in mongosh, load it with `load`:

```js
load('/path/to/mongotab.js')
```

Or load it when you connect. `--shell` keeps the interactive shell open after the file runs:

```bash
mongosh "mongodb://user@host:27017/admin" /path/to/mongotab.js --shell
```

Messages follow the system language. You can also set `MONGOTAB_LANG=en` or `zh`; the examples in this post use English. Loading the file gives you three functions: `t` prints a table, `g` prints vertically (like MySQL's `\G`), and `mt` holds everything else. Common calls:

```js
t(db.orders.find({status: 'paid'}))              // table; switches to vertical when too wide
g(db.orders.findOne())                            // vertical
t(db.orders.find(), 'orderNo,customer,amount')    // only these columns; customer means every field under customer
t(db.orders.find(), {exclude: 'items,raw.*'})     // leave some columns out
t(db.orders.find(), {limit: 200})                 // shows at most 50 rows by default
t(db.orders.find(), {tz: '+08:00'})               // show times in UTC+8 for this call
mt.csv(db.orders.find(), 'orderNo,amount')        // print CSV, ready to paste into Excel
mt.config({tz: 'Asia/Shanghai', maxCol: 60})      // change the defaults for this session
mt.help()
```

### Exporting CSV

To send results to someone else, or to work on them in Excel, use `mt.csv`. It takes the same arguments as `t`, including column selection:

```
rs0 [primary] shop> mt.csv(db.mt_demo.find(), 'orderNo,customer.name,amount,createdAt,remark')
orderNo,customer.name,amount,createdAt,remark
SO20240101001,张三,1299.50,2024-01-01 08:30:00,"加急
周末送达"
SO20240101002,Alice,88.00,2024-01-01 09:00:00,NULL
```

It differs from the table output in two ways. First, a newline inside a string shows as `\n` in a table, but CSV keeps the real newline and wraps the whole value in double quotes. That is standard CSV, and Excel opens it as two lines in one cell. Second, CSV doesn't truncate long values. Times, numbers, null and missing fields are shown the same way as in tables:

```
rs0 [primary] shop> mt.csv(db.orders.find({_id: {$gte: 6, $lte: 9}}), '_id,status,amount,region')
_id,status,amount,region
6,shipped,2.22,apac
7,delivered,2.59,(missing)
8,cancelled,2.96,NULL
9,refunded,3.33,apac
```

## Design choices

### No changes to mongosh itself

Production troubleshooting usually means ssh to a jump host and run mongosh there, and that machine is often shared. People are rightly wary of anything that might change how their session behaves. So MongoTab adds only three global functions, `t`, `g` and `mt`, plus a `mongotab` object. It doesn't touch mongosh's own objects or prototypes, doesn't write `.mongoshrc.js`, and is gone when the session ends.

If a name is already taken, say you defined a variable `t` yourself, MongoTab leaves it alone and tells you so. Use `mongotab.table` instead:

```
rs0 [primary] shop> var t = 1
rs0 [primary] shop> load('/tmp/mongotab.js')
MongoTab 0.1.0 loaded: t(x) table / g(x) vertical / mt.help()   time zone UTC
  Note: t already defined, left untouched; use mongotab.table / mongotab.vertical / mongotab.help()
rs0 [primary] shop> mongotab.table(db.mt_demo.find(), 'orderNo,amount')
+---------------+---------+
| orderNo       | amount  |
+---------------+---------+
| SO20240101001 | 1299.50 |
| SO20240101002 |   88.00 |
+---------------+---------+
2 rows in set
```

### Null vs missing fields

In MySQL a column either has a value or is NULL. MongoDB has a third case: the document doesn't have the field at all. In the lab data, order 7 has no region field and order 8 has region set to null. In the default mongosh output you only notice by reading the field names one by one:

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

In a table the three cases look different. A null value shows as `NULL`. A missing field shows as `(missing)`, dimmed in a terminal (the Chinese marker is `(无字段)`). An empty string shows as a blank cell, as in MySQL:

```
rs0 [primary] shop> t(db.orders.find({_id: {$gte: 6, $lte: 9}}), '_id,region')
+-----+-----------+
| _id | region    |
+-----+-----------+
|   6 | apac      |
|   7 | (missing) |
|   8 | NULL      |
|   9 | apac      |
+-----+-----------+
4 rows in set
```

For an empty string, look back at the `rs.status()` table above: the primary's `syncSourceHost` is the empty string `''`, so that cell is blank.

In vertical output a missing field is simply left out, so order 7's vertical output has no region line. `mt.csv` follows the same rules as tables. In the CSV example earlier, orders 7 and 8 come out as `(missing)` and `NULL`, which stay as plain text in Excel and don't get mixed up with empty cells.

The difference matters when you query. `{region: null}` matches documents where the value is null and documents that don't have the field, so on the four orders above it returns both 7 and 8. To get only missing fields, use `{region: {$exists: false}}`; to get only null values, use `{region: {$type: 'null'}}`.

### BSON types shown the way a DBA reads them

By default mongosh prints BSON values with their type names, such as `ObjectId('...')`, `Decimal128('1299.50')` and `Long('3')`, and in a table those wrappers make columns wide. MongoTab shows them like this:

| BSON type | Shown as |
|---|---|
| ObjectId | Hex string |
| Date | `2024-01-01 08:30:00`, UTC by default, time zone configurable |
| Long, Int32, Double, Decimal128 | Number, right-aligned |
| Timestamp | Time plus the raw value, for example `2026-11-14 14:47:56 (1794667676:1)` |
| UUID | UUID string |
| Newlines and tabs in strings | `\n` and `\t`, so each record stays on one line |

A Timestamp shows both the time and the raw value because an oplog position is a Timestamp. When you compare replication progress between members you need the `seconds:increment` part, and the time alone drops the increment. For example, the optime of each member:

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

Times are shown in UTC by default so they match the logs. If you prefer local time, add `{tz: '+08:00'}`, or set `MONGOTAB_TZ=+08:00` before starting mongosh:

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

This table shows two more things. The nested customer document is expanded into two columns, `customer.name` and `customer.level`. And a CJK character counts as two columns wide, so in a terminal the column holding "张三" and "Alice" lines up. In a web page's monospace font a CJK character isn't always exactly two Latin characters wide, so the table may look slightly off here.

### Vertical output for large documents, with sub-tables for document arrays

Commands like `rs.status()` and `db.serverStatus()` return one large document, and a one-row table of it is useless. When `t` gets a single document, MongoTab lists the plain fields vertically first. Arrays of documents inside it, like `members` in `rs.status()`, become separate sub-tables, as in the examples above.

You can select columns inside a sub-table directly: `members.name` means the name column of the members sub-table. The same works for an order, whose items array becomes a sub-table:

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

### Switching to vertical when the table is too wide

With many fields a table can get wider than the terminal, and once it wraps it's harder to read than before. `t` lays out the table first, and if it's wider than the terminal, it switches to vertical output. The order table from earlier, with the remark column added, is wider than a 120-column terminal, so the output becomes:

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

Add `{table: true}` when you want a table regardless. Cells longer than 40 characters are cut off with `...`; vertical output doesn't truncate.

### 50 rows by default

When you pass a cursor, MongoTab reads only the first 50 rows from it, rather than pulling the whole result set into mongosh and cutting it down afterwards. If there are more rows, the last line tells you how to see them, for example `t(x, {limit: 200})`. A careless `t(db.orders.find())` on a large production collection won't fill the jump host's memory.

## Compared with what mongosh already has

mongosh already offers a few ways to make output easier to read. Here they are on the same collection.

### console.table

mongosh runs on Node.js, so `console.table` is available:

```
rs0 [primary] shop> console.table(db.mt_demo.find().toArray())
┌─────────┬──────────────────────────────────────┬─────────────────┬────────────────────────────────────┬───────────────────────┬────────────┬──────────────────────────┬──────────────────┐
│ (index) │ _id                                  │ orderNo         │ customer                           │ amount                │ qty        │ createdAt                │ remark           │
├─────────┼──────────────────────────────────────┼─────────────────┼────────────────────────────────────┼───────────────────────┼────────────┼──────────────────────────┼──────────────────┤
│ 0       │ ObjectId('6571a2b3c4d5e6f708192a3b') │ 'SO20240101001' │ { name: '张三', level: 'gold' }    │ Decimal128('1299.50') │ Long('3')  │ 2024-01-01T08:30:00.000Z │ '加急\n周末送达' │
│ 1       │ ObjectId('6571a2b3c4d5e6f708192a3c') │ 'SO20240101002' │ { name: 'Alice', level: 'silver' } │ Decimal128('88.00')   │ Long('12') │ 2024-01-01T09:00:00.000Z │ null             │
└─────────┴──────────────────────────────────────┴─────────────────┴────────────────────────────────────┴───────────────────────┴────────────┴──────────────────────────┴──────────────────┘
```

The same data with MongoTab. This terminal is 160 columns wide, so the table fits; in the "too wide" section above, the same command in a 120-column terminal switched to vertical output:

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

`console.table` works, lines up CJK text, and also leaves missing fields blank. The differences: BSON values keep their `ObjectId(...)`, `Decimal128(...)` and `Long(...)` wrappers and widen the columns; the nested customer document is squeezed into one cell; strings are quoted and numbers are left-aligned. It also needs `.toArray()` first, which pulls the whole result set to the client.

`console.table` can take a list of columns, but only top-level fields; a nested path gives an empty column:

```
rs0 [primary] shop> console.table(db.mt_demo.find().toArray(), ['orderNo', 'customer.name', 'amount'])
┌─────────┬─────────────────┬───────────────┬───────────────────────┐
│ (index) │ orderNo         │ customer.name │ amount                │
├─────────┼─────────────────┼───────────────┼───────────────────────┤
│ 0       │ 'SO20240101001' │               │ Decimal128('1299.50') │
│ 1       │ 'SO20240101002' │               │ Decimal128('88.00')   │
└─────────┴─────────────────┴───────────────┴───────────────────────┘
```

It has no vertical output either, so it doesn't help much with a large document like `rs.status()`.

### --json with jq

`mongosh --json=relaxed --eval '...'` prints the result as standard Extended JSON:

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

Then `jq` picks out the fields, which suits scripts:

```
$ mongosh --quiet --json=relaxed "mongodb://mongo1:27017,mongo2:27017,mongo3:27017/shop?replicaSet=rs0" --eval 'db.mt_demo.find().toArray()' | jq -r '.[] | [.orderNo, .customer.name, .amount."$numberDecimal"] | @tsv'
SO20240101001	张三	1299.50
SO20240101002	Alice	88.00
```

This is precise and easy to automate, but you write a bit of jq every time you want to look at something, and you have to remember that types like Decimal128 come out as structures like `{"$numberDecimal": ...}`. It's not what you want for a quick look while troubleshooting.

### GUI tools

GUI tools like Compass do the most, but in production you often only have ssh to a jump host and no GUI.

That last case is what MongoTab is for: a single mongosh terminal and a need to read results quickly.

## Common DBA commands

| MySQL habit | mongosh + MongoTab |
|---|---|
| `SHOW PROCESSLIST` | `t(db.currentOp({active: true}).inprog, 'opid,secs_running,op,ns,client,desc')` |
| `SHOW SLAVE STATUS` | `t(rs.status().members, 'name,stateStr,health,optimeDate,syncSourceHost,lastHeartbeat')` |
| `SHOW DATABASES` | `t(db.adminCommand({listDatabases: 1}).databases)` |
| `SHOW INDEX FROM t` | `t(db.orders.getIndexes())` |
| `SHOW GLOBAL STATUS` | `t(db.serverStatus(), 'connections,opcounters,mem')` |

For example, finding a slow query that's running right now. Each `currentOp` record has 30 fields and the default output runs to dozens of lines; a few columns make it clear:

```
rs0 [primary] shop> t(db.currentOp({active: true, ns: 'shop.orders'}).inprog, 'opid,secs_running,op,ns,client,appName,planSummary')
+--------+--------------+---------+-------------+--------------------+------------+-------------+
| opid   | secs_running | op      | ns          | client             | appName    | planSummary |
+--------+--------------+---------+-------------+--------------------+------------+-------------+
| 392195 |            1 | getmore | shop.orders | 192.168.97.3:56612 | report-job | COLLSCAN    |
+--------+--------------+---------+-------------+--------------------+------------+-------------+
1 row in set
```

`appName` is the application name the client set in its connection string, and a `planSummary` of `COLLSCAN` means the query is scanning the whole collection. If you decide to stop it, run `db.killOp(392195)`.

For mapping MySQL commands to MongoDB more generally, I keep a lookup page: [DBA Command Finder](https://www.solidstack.io/dba-command-finder/).

## Finally

MongoTab only changes how results are displayed. Queries run as usual, and it changes neither the results nor the execution plan. It's at version 0.1.0; if you run into problems or have ideas, issues on GitHub are welcome.
