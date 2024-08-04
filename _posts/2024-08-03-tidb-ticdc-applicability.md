---
title: "如何确定 TiDB 集群可以使用 TiCDC 同步数据？"
date: 2024-08-03
permalink: /posts/2024/08/ticdc-applicability/
category: TiDB
tags: [TiCDC]
imagefeature: cover5.jpg 
comments: true
featured: true
---
本文主要围绕 TiCDC 的限制中比较**难确定**的部分内容，TiCDC 官方文档中已经清楚的描述了不支持的场景以及必须满足的条件。

目前 TiCDC 暂不支持的场景如下：
- 暂不支持单独使用 RawKV 的 TiKV 集群。
- 暂不支持在 TiDB 中创建 SEQUENCE 的 DDL 操作和 SEQUENCE 函数。在上游 TiDB 使用 SEQUENCE 时，TiCDC 将会忽略掉上游执行的 SEQUENCE DDL 操作/函数，但是使用 SEQUENCE 函数的 DML 操作可以正确地同步。
- 暂不支持在同步的过程中对 TiCDC 正在同步的表和库进行 BR 数据恢复 和 TiDB Lightning 物理导入。详情请参考为什么在上游使用了 TiDB Lightning 和 BR 恢复了数据之后，TiCDC 同步会出现卡顿甚至卡住。
- TiCDC 同步的表需要至少存在一个有效索引的表。

详见[官方文档](https://docs.pingcap.com/tidb/stable/ticdc-overview#ticdc-overview) 中 [暂不支持的场景](https://docs.pingcap.com/tidb/stable/ticdc-overview#unsupported-scenarios)  和 [最佳实践](https://docs.pingcap.com/tidb/stable/ticdc-overview#best-practices)。

这些限制中最不好判断的是**有效索引**这一条：
>TiCDC同步的表需要至少存在一个有效索引的表，有效索引的定义如下：
>
>主键 (PRIMARY KEY) 为有效索引。
>
>唯一索引 (UNIQUE INDEX) 中每一列在表结构中明确定义非空 (NOT NULL) 且不存在虚拟生成列 (VIRTUAL GENERATED COLUMNS)。

如果 TiDB 集群中有表没有有效索引，那么这些表是不能利用 TiCDC 来同步数据的，如何集群中哪些表没有有效索引呢？推导如下：

1.找出既没有主键，也没有唯一键的表，这些表肯定是不能同步的

```sql
SELECT table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and (table_schema,table_name) not in (select table_schema,table_name from information_schema.tidb_indexes where NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) and table_type='BASE TABLE';
```

2.没有主键，但是有唯一键，并且唯一键中包含有默认为 NULL 的列或者是生成列

```sql
SELECT a.table_schema, a.table_name from (select table_schema, table_name, column_name from information_schema.tidb_indexes where NON_UNIQUE=0 and KEY_NAME<>'PRIMARY' and (table_schema, table_name) not in (select table_schema, table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY') and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='YES' or b.GENERATION_EXPRESSION<>'');
```

以上两种表的并集就是没有有效索引的表。

### 总结
最后取并集如下，就是我们需要的没有有效索引的表的集合，如果以下 SQL 的查询结果为非空，则查询结果中的表不能使用 TiCDC 来同步数据：

```sql
SELECT table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and (table_schema,table_name) not in (select table_schema,table_name from information_schema.tidb_indexes where NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) and table_type='BASE TABLE'
union all
SELECT a.table_schema, a.table_name from (select table_schema, table_name, column_name from information_schema.tidb_indexes where NON_UNIQUE=0 and KEY_NAME<>'PRIMARY' and (table_schema, table_name) not in (select table_schema, table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY') and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='YES' or b.GENERATION_EXPRESSION<>'');
```

### 其他
还有一个关于不支持 SEQUENCE 相关操作的限制，找出集群中是否使用了 SEQUENCE 是很简单的，SQL 如下，如果查询结果为非空，则说明使用了 SEQUENCE：

```sql
SELECT table_schema, table_name, table_type from information_schema.tables where table_type='SEQUENCE';
```
