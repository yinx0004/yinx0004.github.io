---
layout: post
title: "用 Prometheus 指标给分布式数据库做容量规划：以 TiDB 为例"
date: 2026-10-10
permalink: /posts/2026/10/tidb-capacity-planning-prometheus/
lang: zh-CN
ref: capacity-planning-prometheus
category: TiDB
tags: [容量规划, TiDB, Prometheus, 稳定性, 分布式系统]
description: "基于 Prometheus 监控数据估算 TiDB 集群需要多少节点：怎么选观察窗口，为什么用分位数而不是峰值，每种资源的水位线怎么定，以及如何找到瓶颈资源。"
imagefeature: cover3.jpg
comments: true
featured: false
toc: true
---
“下个季度要扩多少台？”做数据库的团队几乎都被问过这个问题，通常是在大促或者新业务上线前几周。常见的做法是先拍一个数，再乘个系数“保险一点”，结果要么当天不够用，要么一年里大部分时间都在浪费机器。

之前我和一位同事写过一个小工具 [tidbcloud-metrics](https://github.com/yinx0004/tidbcloud-metrics)，用 Prometheus 里现成的监控数据来回答这个问题。超大规模的 TiDB Cloud 集群每次大促前要做容量评估、决定扩多少节点，我们都靠它来算。代码和当时的环境绑得比较紧，但方法本身是通用的。这篇文章用虚构的数据把这套方法过一遍：采哪些指标，怎么汇总，留多少余量，以及这个简单模型在哪些地方不准。

例子用的是 TiDB，换成其他分布式数据库，或者任何按节点暴露指标的无状态服务，思路都一样。

## 核心公式

对每个组件的每种资源，需要的节点数是：

```
所需节点数 = (单节点用量 × 当前节点数 × 业务增长倍数) / (单节点容量 × 目标水位)
```

- 单节点用量：观察窗口内每个节点对这种资源的用量汇总值，比如 P99。
- 单节点用量 × 当前节点数：大致等于集群当前的总需求。
- 业务增长倍数：预计流量会涨多少，1.5 就是涨 50%。
- 单节点容量：一个节点能提供多少，比如 32 核或 2 TiB 磁盘。
- 目标水位：你愿意让节点跑到多满。除以 0.5 意味着希望节点利用率不超过 50%。

每个组件的每种资源都算一遍，需要节点最多的那种资源就是瓶颈，它决定这个组件最终要多少节点。

<figure>
<svg viewBox="0 30 900 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="cpz-title cpz-desc" style="display:block;width:100%;max-width:900px;height:auto;margin:0 auto;font-family:'Open Sans','PingFang SC','Microsoft YaHei',sans-serif">
  <title id="cpz-title">容量规划流程</title>
  <desc id="cpz-desc">从 Prometheus 取每个节点的资源用量，汇总成分位数，乘以节点数和增长倍数，再除以单节点容量乘目标水位，得到每种资源所需节点数，取最大值作为瓶颈。</desc>
  <defs>
    <marker id="cpz-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e51843"/></marker>
  </defs>
  <rect x="10" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="85" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">Prometheus</text>
  <text x="85" y="98" text-anchor="middle" font-size="12" fill="#555">各节点资源用量</text>
  <rect x="197" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="272" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">汇总</text>
  <text x="272" y="98" text-anchor="middle" font-size="12" fill="#555">P50 … P99.9、最大值</text>
  <rect x="384" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="459" y="72" text-anchor="middle" font-size="14" font-weight="700" fill="#222">换算</text>
  <text x="459" y="92" text-anchor="middle" font-size="12" fill="#555">× 节点数 × 增长</text>
  <text x="459" y="110" text-anchor="middle" font-size="12" fill="#555">/ (容量 × 水位)</text>
  <rect x="571" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="646" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">所需节点数</text>
  <text x="646" y="98" text-anchor="middle" font-size="12" fill="#555">按资源分别计算</text>
  <rect x="758" y="40" width="132" height="90" rx="6" fill="#fde3e9" stroke="#e51843"/>
  <text x="824" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#9c0f2f">瓶颈</text>
  <text x="824" y="98" text-anchor="middle" font-size="12" fill="#9c0f2f">取最大值</text>
  <line x1="160" y1="85" x2="195" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cpz-arrow)"/>
  <line x1="347" y1="85" x2="382" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cpz-arrow)"/>
  <line x1="534" y1="85" x2="569" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cpz-arrow)"/>
  <line x1="721" y1="85" x2="756" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cpz-arrow)"/>
</svg>
</figure>

## 第一步：选观察窗口

数字取决于你查的是哪段时间，所以这段时间里必须包含你要规划的那种负载。

- 至少覆盖一个完整的业务周期，一般是一周，这样工作日和周末的规律都在里面。
- 确认窗口里有已知的高峰：月底跑批、上一次大促、每天的报表任务。
- 如果是为某个特定活动做规划，就去查最接近的一次历史活动，再用增长倍数放大。
- 注意查询步长。窗口很长、步长又大，短时间的尖峰会被平均掉。我当时查两天数据用 60 秒步长，查一天用 30 秒。

## 第二步：按组件和资源采集用量

TiDB 集群主要有四个组件。每个节点上都跑着 node_exporter，所以 CPU、内存、磁盘 IOPS、磁盘带宽、网络带宽这些主机指标，四个组件都有，也都要算一遍。不过各组件用磁盘和网络的方式不一样，最先耗尽的资源也不一样：

| 组件 | 磁盘和网络用在哪 | 通常先碰到的上限 |
|---|---|---|
| TiDB（SQL 层） | 磁盘：日志，大查询内存不够时排序和 hash join 落盘。网络：接收客户端请求，从 TiKV、TiFlash 拉数据，返回结果 | CPU、内存、网络带宽 |
| TiKV（行存） | 磁盘：数据、Raft 日志、compaction。网络：Raft 复制到其他副本，响应 TiDB 的读写 | CPU、存储、磁盘 IOPS、磁盘带宽 |
| TiFlash（列存） | 磁盘：列存数据和后台合并。网络：从 TiKV 同步数据，MPP 计算时节点之间交换数据 | CPU、内存、存储、磁盘带宽 |
| PD（调度和授时） | 磁盘：etcd 存集群元数据，对 fsync 延迟敏感。网络：心跳、TSO 请求 | CPU、内存、磁盘延迟 |

磁盘 IOPS、磁盘带宽和网络带宽是三个不同的上限，要分开算：

- 磁盘 IOPS 是每秒读写的次数。小而随机的 IO 先碰到它，比如 TiKV 的点查，RocksDB 读不在缓存里的数据块。
- 磁盘带宽是每秒读写的字节数。大块的顺序 IO 先碰到它，比如 compaction、大范围扫描、TiFlash 读列存文件、备份。
- 网络带宽是网卡每秒收发的字节数。TiKV 每次写入，leader 都要把日志发给另外两个副本，而且是跨可用区的。TiDB 从 TiKV 拉数据、把结果返回给客户端，还有备份和数据均衡，也都走网络。

同一块盘可能 IOPS 只用了 30%，带宽已经到了 80%，合在一起看就会漏掉真正的瓶颈。

CPU、内存和存储用 TiDB 自己暴露的指标，磁盘和网络用 node_exporter 的主机指标：

```
# 每个 TiDB 实例使用的 CPU 核数
rate(process_cpu_seconds_total{component="tidb"}[2m])

# 每个 TiDB 实例的常驻内存
process_resident_memory_bytes{component="tidb"}

# 每个 TiKV store 已用存储
sum(tikv_store_size_bytes{type="used"}) by (instance)

# 每个 TiFlash store 已用存储
sum(tiflash_system_current_metric_StoreSizeUsed) by (instance)

# 磁盘 IOPS（读 + 写）
sum(rate(node_disk_reads_completed_total{device="nvme1n1"}[1m])
  + rate(node_disk_writes_completed_total{device="nvme1n1"}[1m])) by (instance)

# 磁盘带宽，字节/秒（读 + 写）
sum(rate(node_disk_read_bytes_total{device="nvme1n1"}[1m])
  + rate(node_disk_written_bytes_total{device="nvme1n1"}[1m])) by (instance)

# 网络带宽，字节/秒，入和出分开看
sum(rate(node_network_receive_bytes_total{device="eth0"}[1m])) by (instance)
sum(rate(node_network_transmit_bytes_total{device="eth0"}[1m])) by (instance)
```

`nvme1n1` 和 `eth0` 要换成实际的数据盘和网卡名。

单节点容量能从指标拿就从指标拿，比如 `tikv_store_size_bytes{type="capacity"}`、`node_memory_MemTotal_bytes`。拿不到的就查机型和云盘的官方规格，有几处要注意：

- 磁盘 IOPS 和带宽同时受云盘和机型限制。以 AWS 为例，gp3 盘的 IOPS 和吞吐按盘配置，实例本身也有 EBS 带宽和 IOPS 上限，取两者中较小的那个。
- 网络带宽看基线值。很多机型标的是 "up to 10 Gbps"，那是突发上限，能持续的基线要低得多。
- 单位要统一。网络规格一般用 bit/s，指标是 byte/s，要乘 8 再比较。

CPU 建议用 `rate()` 而不是 `irate()`。`irate()` 只看最后两个采样点，放在监控面板上看瞬时值没问题，但拿来算长窗口的分位数会抖得比较厉害。

## 第三步：用分位数，不用峰值

按最大值规划听起来最稳，但最大值往往只是一次尖峰：一次备份、一次数据均衡、一条烂 SQL。假设 TiDB 单节点 CPU 峰值是 22 核，P99 是 14 核，按峰值规划要多买大约 57% 的节点，只为了覆盖每天那几分钟，而集群本来就扛得住。

我会对每种资源都算一组统计值，从 P50 到 P99.9 再加最大值，然后决定用哪个：

- CPU、磁盘 IOPS、磁盘带宽和网络带宽默认用 P99，能过滤偶发尖峰，又保留了日常的忙时。
- 存储不看分位数，看最新值和增长趋势。存储基本只增不减，要关心的是下个季度会涨到多少，具体算法在文章后面。
- 忽略最大值之前，先看看它是什么。如果那个尖峰正是业务最忙的时段，而不是某个一次性任务，那就应该按它来规划。

## 第四步：定水位线

目标水位是整套方法里最需要判断的地方。我们最早的版本对所有资源统一用 3.3 倍冗余，相当于目标水位 30% 左右。这样很好解释，但它把 CPU 和磁盘当成一回事，而它们的行为差别很大。

每种资源要分别考虑：

- 故障余量。节点平均分布在三个可用区时，挂掉一个可用区，它的负载会压到另外两个上。要扛住这种情况，平时利用率就得低于三分之二左右，这还没算其他余量。
- 延迟。CPU 真正的上限是延迟开始上升的那个点，而不是 100%。很多 OLTP 业务在这个点上离跑满还很远，要给突发留空间。
- 后台任务。存储引擎做 compaction 需要空闲磁盘，加减节点时数据均衡也要空间，磁盘快满的时候这两件事都做不了。
- TiDB 内存可以按线性算。TiDB 是无状态的 SQL 层，内存主要是执行查询时临时分配的，比如 hash join、排序、聚合和结果集，查询结束就释放，没有一块预先占满的大缓存池。所以它大致跟并发和查询量成正比，流量涨多少，内存也差不多涨多少。算的时候先从单节点容量里减掉一块固定开销（系统、Go runtime、统计信息缓存等），剩下的再按流量放大。另外 RSS 里包含 GC 还没回收的内存，大查询也会带来尖峰，这也是用 P99 而不是平均值的原因。
- 池化的内存不能按线性算。TiKV 的 block cache 和 MySQL 的 InnoDB buffer pool 一样，是按配置预先划好的缓存，用着用着就会被填满，不管流量多少，内存看起来都一直很高。它反映的是配置而不是需求，所以 TiKV 不按内存规划，缓存够不够要看命中率。

## 第五步：找瓶颈

一个虚构的 TiKV 例子：9 个节点，平均分布在 3 个可用区，每台 32 核、2,000 GiB 磁盘，预计下季度流量涨 50%。算出来的节点数按 3 的倍数向上取整，原因在本节最后。

所有资源统一用 3.3 倍冗余：

| 资源 | 单节点用量 | 计算 | 所需节点 |
|---|---|---|---|
| CPU（P99） | 12 核 | 12 × 9 × 1.5 × 3.3 / 32 | 16.7 → 18 |
| 存储（最新值） | 900 GiB | 900 × 9 × 1.5 × 3.3 / 2000 | 20.05 → 21 |

按资源分别设水位，CPU 50%，存储 70%：

| 资源 | 单节点用量 | 计算 | 所需节点 |
|---|---|---|---|
| CPU（P99） | 12 核 | 12 × 9 × 1.5 / (32 × 0.5) | 10.1 → 12 |
| 存储（最新值） | 900 GiB | 900 × 9 × 1.5 / (2000 × 0.7) | 8.7 → 9 |

统一系数算出来要 21 台，瓶颈是存储；分资源设水位算出来要 12 台，瓶颈是 CPU。两次用的是同一个公式，差别全部来自水位线，所以时间应该花在这里。为了简单，这里存储也乘了 1.5，更好的做法是按历史趋势算，后面单独讲。

最后还要取整，但不同组件的规则不一样：

- TiKV：默认 3 副本，PD 按可用区把同一个 Region 的 3 个副本放到 3 个可用区，每个可用区各存一份完整数据。某个可用区的节点少，那里的每个节点就要多扛数据和写入，整个集群的上限会被它拖住。所以各可用区的节点数要一样多。TiDB Cloud Dedicated 直接把这个做成了规则：TiKV 至少 3 台，扩缩容时 3 个可用区同时增减，步长是 3。所以上面例子里 CPU 算出 10.1 台，要取到 12 台，而不是 11 台。自建集群如果没打 label，或者隔离域比副本多，就没有这个限制。
- TiFlash：同样平均部署到各可用区，副本数按表设置，生产环境建议至少 2 副本。各可用区节点数保持一致可以避免倾斜，但没有 TiKV 那样硬性的 3 的倍数要求。
- TiDB：无状态，前面挂负载均衡，算出几台就是几台，不需要凑倍数。跨可用区部署时，保证每个可用区至少有一台就行。
- PD：一般固定 3 个或 5 个节点，Raft 需要多数派，所以取奇数。它通常不随业务量扩容，不用这个公式算。

## 这个模型在哪里不准

公式假设流量翻倍资源用量也翻倍，并且加节点后负载能均匀分摊。这两点都只是大致成立。

- 热点。集群整体的分位数可能很健康，但某一个节点已经被热点表或热点 key 范围打满了。除了看汇总，也要看最忙的那个节点，先解决倾斜再考虑加机器。
- 非线性增长。有些开销涨得比流量快：写入很重时的 compaction、锁冲突、跨节点事务。增长幅度大的时候，最好用压测验证一下。
- 突发性能。云主机的网络和磁盘吞吐通常有基线和突发两个上限。要按基线规划，不然突发额度会在最要命的时候用完。
- 硬件以外的限制。连接数上限、Region 数量、PD 授时延迟，都可能比 CPU 和磁盘更早成为瓶颈。当时我们在容量规划之外还配了一个健康检查，按阈值把这些指标标出来。

## 如果现在重做

### 用 SLO 定水位

前面的目标水位，CPU 50%、存储 70%，都是经验值。更好的做法是从 SLO 反推。

先要分清 SLA 和 SLO。TiDB Cloud 对外的 SLA 只有可用性一个指标：每分钟探测一次连接，一分钟内全部失败才算这一分钟不可用，Dedicated 多节点部署承诺每月 99.99%。这是底线，集群慢到延迟翻了几倍，只要还能连上就不算违约，所以拿它判断资源是否饱和没有意义。容量规划要看的是业务自己的 SLO，一般由延迟和错误率组成，比如 P99 延迟低于 50 ms、错误率低于 0.1%。

TiDB 里对应的指标：

```
# TiDB 层 P99 查询延迟
histogram_quantile(0.99,
  sum(rate(tidb_server_handle_query_duration_seconds_bucket[1m])) by (le))

# 错误率
sum(rate(tidb_server_query_total{result="Error"}[1m]))
  / sum(rate(tidb_server_query_total[1m]))

# TiKV 层 P99 gRPC 延迟，用来判断慢在哪一层
histogram_quantile(0.99,
  sum(rate(tikv_grpc_msg_duration_seconds_bucket[1m])) by (le, type))
```

接下来要找饱和点，也就是回答一个问题：CPU 利用率涨到多少时，延迟会超出 SLO。

数据有两种来源。一种是历史监控：把过去几周每一分钟的 CPU 利用率和同一分钟的 P99 延迟配成一对，画在图上，横轴是 CPU 利用率，纵轴是 P99 延迟。另一种是压测：在测试环境逐步加压，比如每 10 分钟把 QPS 提高 10%，记录每一档的 CPU 利用率和 P99 延迟。

画出来的图通常像下面这样。CPU 利用率低的时候，请求不用排队，延迟基本不变。过了某个利用率，请求开始排队，延迟急剧上升。在 SLO 的位置画一条横线，它和曲线交点对应的 CPU 利用率就是饱和点，CPU 再往上就会违反 SLO。

<figure>
<svg viewBox="0 0 600 305" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="slz-title slz-desc" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;font-family:'Open Sans','PingFang SC','Microsoft YaHei',sans-serif">
  <title id="slz-title">CPU 利用率与 P99 延迟</title>
  <desc id="slz-desc">示意图：CPU 利用率低于约 50% 时 P99 延迟稳定在 10 ms 左右，之后快速上升，在 75% 时达到 50 ms 的 SLO，这就是饱和点；考虑挂掉一个可用区后负载变为 1.5 倍，目标水位为 50%。</desc>
  <line x1="60" y1="40" x2="60" y2="260" stroke="#999"/>
  <line x1="60" y1="260" x2="560" y2="260" stroke="#999"/>
  <text x="52" y="264" text-anchor="end" font-size="12" fill="#555">0</text>
  <text x="52" y="154" text-anchor="end" font-size="12" fill="#555">50 ms</text>
  <text x="52" y="44" text-anchor="end" font-size="12" fill="#555">100 ms</text>
  <text x="60" y="278" text-anchor="middle" font-size="12" fill="#555">0%</text>
  <text x="185" y="278" text-anchor="middle" font-size="12" fill="#555">25%</text>
  <text x="310" y="278" text-anchor="middle" font-size="12" fill="#555">50%</text>
  <text x="435" y="278" text-anchor="middle" font-size="12" fill="#555">75%</text>
  <text x="560" y="278" text-anchor="middle" font-size="12" fill="#555">100%</text>
  <text x="310" y="300" text-anchor="middle" font-size="13" fill="#222">CPU 利用率</text>
  <text x="14" y="150" text-anchor="middle" font-size="13" fill="#222" transform="rotate(-90 14 150)">P99 延迟</text>
  <line x1="60" y1="150" x2="560" y2="150" stroke="#9c0f2f" stroke-dasharray="6 4"/>
  <text x="556" y="143" text-anchor="end" font-size="12" fill="#9c0f2f">SLO 50 ms</text>
  <line x1="310" y1="60" x2="310" y2="260" stroke="#888" stroke-dasharray="4 4"/>
  <text x="302" y="74" text-anchor="end" font-size="12" fill="#333">目标水位 50%</text>
  <text x="302" y="90" text-anchor="end" font-size="12" fill="#333">= 75% / 1.5</text>
  <line x1="435" y1="150" x2="435" y2="260" stroke="#e51843" stroke-dasharray="4 4"/>
  <polyline fill="none" stroke="#e51843" stroke-width="2.5" points="60,238 310,238 335,236.5 360,229.2 385,213.4 410,187.6 435,150 460,99.4 480,48.1"/>
  <circle cx="435" cy="150" r="4.5" fill="#e51843"/>
  <text x="443" y="200" font-size="12" font-weight="700" fill="#e51843">饱和点 75%</text>
</svg>
</figure>

图里的饱和点是 75%。三个可用区挂掉一个时，剩下两个要多扛 50% 的负载，所以平时的利用率不能超过 75% / 1.5 = 50%，这就是 CPU 的目标水位。前面例子里的 50% 就是这么来的。不同业务的饱和点差别很大，OLTP 小查询可能到 80% 延迟都很稳，带大量排序和聚合的查询可能 60% 就开始抖，所以每个集群要单独看。

### 存储按趋势算

存储的增长主要取决于写入量和数据保留策略，跟 QPS 的关系不大，所以不适合乘一个流量增长倍数，按历史趋势算更准。

1. 取过去 3 到 6 个月的已用存储，每天取一个点，用当天的最大值或平均值把 compaction 造成的锯齿抹平。`sum(tikv_store_size_bytes{type="used"})` 是所有副本加起来的总量，和单节点容量比的时候要用同一个口径。
2. 用线性回归求出斜率，比如集群每天增长 60 GiB。Prometheus 自带的 `predict_linear()` 可以直接给出预测值，比如 `predict_linear(sum(tikv_store_size_bytes{type="used"})[30d:1h], 90*86400)` 是 90 天后的用量。不过 Prometheus 一般只保留 15 到 30 天的数据，要看更长的趋势，需要 Thanos、VictoriaMetrics 这类长期存储，或者每天把总量记到一张表里。
3. 算出规划时点的用量：未来用量 = 当前用量 + 斜率 × (到下次评审的天数 + 扩容准备时间)。准备时间一定要算进去，加完节点后数据均衡也要时间，不能等到快满了才扩。
4. 把未来用量代入公式，增长倍数取 1，因为趋势里已经包含了增长。

接着前面的例子：9 台 TiKV 现在一共用了 8,100 GiB，每天涨 60 GiB，规划 90 天，再留 30 天准备时间。

```
未来用量 = 8,100 + 60 × (90 + 30) = 15,300 GiB
所需节点 = 15,300 / (2,000 × 0.7) = 10.9 → 12
```

同样的数据还能算出一个很实用的告警指标：

```
距离到达水位的天数 = (总容量 × 目标水位 − 当前用量) / 每天增长量
```

这个天数小于扩容准备时间，就该扩了。

拟合时有几个坑：

- 一次性事件会把斜率带偏，比如批量导入、TTL 删除、DROP 表。DROP 表之后空间要等 GC 和 compaction 才会释放，曲线会先平一段再往下掉。拟合前要把这些时段剔掉。
- 增长不一定是线性的。如果每周增长的百分比比较稳定，说明是复利式增长，要先对用量取对数再拟合，否则会低估。

### 其他

- 报告里加上单节点倾斜，让热点和总量出现在同一份结果里。
- 定期跑。每周跑一次，预测的节点数变化时告警，而不是每次大促前临时跑一下。

## 检查清单

1. 观察窗口至少一周，并且包含业务高峰。
2. 按组件、按资源分别采集用量和容量。
3. CPU 和网络用 P99，存储用最新值加趋势。
4. 每种资源单独定水位，CPU 从延迟 SLO 反推，再考虑故障余量和后台任务。
5. 按资源分别算节点数，最大的那个就是瓶颈。
6. TiKV 各可用区节点数保持一样（TiDB Cloud 上是 3 的倍数），TiDB 不用凑倍数。
7. 看一眼最忙的节点，变化大的时候做压测。
