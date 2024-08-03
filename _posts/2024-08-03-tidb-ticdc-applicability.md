---
layout: post
title: "如何确定我的 TiDB 集群可以使用 TiCDC 同步数据？"
description: 
headline: 
date: 2024-08-03
permalink: /posts/2024/08/ticdc-applicability/
category: TiDB
tags: [TiCDC]
imagefeature: cover1.jpg
mathjax: 
chart: 
comments: true
featured: true
---
本文主要围绕 TiCDC 不支持的场景，根据官方文档[暂不支持的场景](https://docs.pingcap.com/zh/tidb/stable/ticdc-overview#%E6%9A%82%E4%B8%8D%E6%94%AF%E6%8C%81%E7%9A%84%E5%9C%BA%E6%99%AF) 和 [最佳实践](https://docs.pingcap.com/zh/tidb/stable/ticdc-overview#%E6%9A%82%E4%B8%8D%E6%94%AF%E6%8C%81%E7%9A%84%E5%9C%BA%E6%99%AF) 中的描述，其中最不好判断的是这一条：
>TiCDC 同步的表需要至少存在一个有效索引的表，有效索引的定义如下：
>
>主键 (PRIMARY KEY) 为有效索引。
>
>唯一索引 (UNIQUE INDEX) 中每一列在表结构中明确定义非空 (NOT NULL) 且不存在虚拟生成列 (VIRTUAL GENERATED COLUMNS)。

如果 TiDB 集群中有表没有有效索引，那么这些表是不能利用 TiCDC 来同步数据的，如何集群中哪些表没有有效索引呢？推导如下：
1. 找出既没有主键，也没有唯一键的表，这些表肯定是不能同步的
2. 没有主键，但是有唯一键，并且唯一键中包含有默认为 NULL 的列或者是生成列
以上两种表的并集就是没有有效索引的表。

如何找出找出既没有主键，也没有唯一键的表？

<code>SELECT table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and (table_schema,table_name) not in (select table_schema,table_name from information_schema.tidb_indexes where NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) and table_type='BASE TABLE';</code>

如何找出没有主键，但是有唯一键，并且唯一键中包含有默认为 NULL 的列或者是生成列？

<code>SELECT a.table_schema, a.table_name from (select table_schema, table_name, column_name from information_schema.tidb_indexes where NON_UNIQUE=0 and KEY_NAME<>'PRIMARY' and (table_schema, table_name) not in (select table_schema, table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY') and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='YES' or b.GENERATION_EXPRESSION<>'');</code>

最后取并集如下，就是我们需要的没有有效索引的表的集合，如果以下 SQL 的查询结果为非空，则查询结果中的表不能使用 TiCDC 来同步数据：

<code>SELECT table_schema, table_name from information_schema.tables where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys') and (table_schema,table_name) not in (select table_schema,table_name from information_schema.tidb_indexes where NON_UNIQUE=0 and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) and table_type='BASE TABLE'
union all
SELECT a.table_schema, a.table_name from (select table_schema, table_name, column_name from information_schema.tidb_indexes where NON_UNIQUE=0 and KEY_NAME<>'PRIMARY' and (table_schema, table_name) not in (select table_schema, table_name from information_schema.tidb_indexes where KEY_NAME='PRIMARY') and table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) a left join (select TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,IS_NULLABLE,GENERATION_EXPRESSION from information_schema.columns where table_schema not in ('METRICS_SCHEMA','mysql','PERFORMANCE_SCHEMA','INFORMATION_SCHEMA','sys')) b on a.table_schema=b.table_schema and a.table_name=b.table_name and a.column_name=b.column_name where (b.IS_NULLABLE='YES' or b.GENERATION_EXPRESSION<>'');</code>

另外还有一个关于不支持 SEQUENCE 相关操作的限制，找出集群中是否使用了 SEQUENCE 是很简单的，SQL 如下，如果查询结果为非空，则说明使用了 SEQUENCE：

<code>SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE from information_schema.tables where TABLE_TYPE='SEQUENCE';</code>