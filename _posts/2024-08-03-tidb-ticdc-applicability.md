---
title: "How to ensure TiDB cluster can use TiCDC to synchronize data?"
date: 2024-08-03
permalink: /posts/2024/08/ticdc-applicability/
category: TiDB
tags: [TiCDC]
imagefeature: cover5.jpg 
comments: true
featured: true
---
This article focuses on the more **difficult to determine** parts of the TiCDC's limitations. 

Currently, TiCDC unsupported scenarios and limitations as below:
- A TiKV cluster that uses RawKV alone.
- The CREATE SEQUENCE DDL operation and the SEQUENCE function in TiDB. When the upstream TiDB uses SEQUENCE, TiCDC ignores SEQUENCE DDL operations/functions performed upstream. However, DML operations using SEQUENCE functions can be correctly replicated.
- Currently, performing BR data recovery and TiDB Lightning physical import imports on tables and databases that are being replicated by TiCDC is not supported. For more information, see Why does replication using TiCDC stall or even stop after data restore using TiDB Lightning and BR from upstream.
- TiCDC only replicates tables that have at least one valid index

For details, refer to the official documentation [unsupported scenarios](https://docs.pingcap.com/tidb/stable/ticdc-overview#unsupported-scenarios) and [best practices](https://docs.pingcap.com/tidb/stable/ticdc-overview#best-practices).

The most difficult part of these limitations to be identified is **the valid index**:
>TiCDC only replicates tables that have at least one valid index. A valid index is defined as follows:
>
>A primary key (PRIMARY KEY) is a valid index.
>
>A unique index (UNIQUE INDEX) is valid if every column of the index is explicitly defined as non-nullable (NOT NULL) and the index does not have a virtual generated column (VIRTUAL GENERATED COLUMNS).

If there are tables in the TiDB cluster without at least one valid index, then these tables cannot use TiCDC to synchronize data. How to find out which tables in the cluster do not have any valid index? 

1.Find tables that have primary key 
```sql
select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys');
```

2.Find tables have unique index and every column of the index is explicitly defined as non-nullable (NOT NULL) and the index does not have a virtual generated column
```sql
select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION='');
```

3.Combine the result of the above two sets are the tables have valid index

```sql
select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')
union all
select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION='');
```

### Conclusion

**Tables Without Valid Index** = **All Tables** - **Tables With Valid Index**, if the result set of the follow SQL is not empty, means the TiDB cluster contains tables can not be replicated by TiCDC.

```sql
select table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and table_type='BASE TABLE' and (table_schema, table_name) not in (select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') union all select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION=''));
```

### Others
About another limitation not supporting SEQUENCE related operations. It is very simple to find out whether SEQUENCE is used in the cluster. The SQL is as follows. If the query result is not empty, it means that SEQUENCE is used:

```sql
SELECT table_schema, table_name, table_type from information_schema.tables where table_type='SEQUENCE';
```

---

&nbsp;
&nbsp;
&nbsp;
&nbsp;


## 中文版
本文主要围绕 TiCDC 的限制中比较**难确定**的部分内容，TiCDC 官方文档中已经清楚的描述了不支持的场景以及必须满足的条件。

目前 TiCDC 暂不支持的场景和限制如下：
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

1.找出有主键的表

```sql
select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys');
```

2.找出有唯一索引并且索引中每一列在表结构中明确定义非空 (NOT NULL) 且不存在虚拟生成列的表

```sql
select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION='');
```

3.以上两种表的并集就是含有有效索引的表。

```sql
select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') 
union all 
select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION='');
```

### 总结
**没有有效索引的表** = **所有的表** - **含有有效索引的表**，如果以下 SQL 的查询结果为非空，则表示 TiDB 集群中包含有不能使用 TiCDC 来同步数据的表：

```sql
select table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and table_type='BASE TABLE' and (table_schema, table_name) not in (select distinct table_schema,table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY' and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') union all select distinct a.table_schema, a.table_name from (select table_schema,table_name,column_name from information_schema.tidb_indexes where KEY_NAME<>'PRIMARY' and NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='NO' and b.GENERATION_EXPRESSION=''));
```

### 其他
还有一个关于不支持 SEQUENCE 相关操作的限制，找出集群中是否使用了 SEQUENCE 是很简单的，SQL 如下，如果查询结果为非空，则说明使用了 SEQUENCE：

```sql
SELECT table_schema, table_name, table_type from information_schema.tables where table_type='SEQUENCE';
```
