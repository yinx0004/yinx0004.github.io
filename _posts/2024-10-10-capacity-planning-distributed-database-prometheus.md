---
layout: post
title: "Capacity Planning a Distributed Database from Prometheus Metrics"
date: 2024-10-10
permalink: /posts/2024/10/capacity-planning-distributed-database-prometheus/
redirect_from:
  - /posts/2026/10/capacity-planning-distributed-database-prometheus/
lang: en
ref: capacity-planning-prometheus
category: TiDB
tags: [Capacity Planning, TiDB, Prometheus, Reliability, Distributed Systems]
description: "A practical way to size a TiDB cluster from Prometheus data: pick the right window, plan on percentiles instead of peaks, set a target utilization per resource, and find the bottleneck."
imagefeature: cover3.jpg
comments: true
featured: true
toc: true
---
"How many nodes do we need for next quarter?" is a question every database team gets, usually a few weeks before a big launch or a sales event. The honest answer often starts with a guess, gets padded "to be safe", and ends with a cluster that is either too small on the day or far too big for the rest of the year.

A while ago a colleague and I wrote a small tool, [tidbcloud-metrics](https://github.com/yinx0004/tidbcloud-metrics), that answered it from the metrics we already had in Prometheus. Before every big sales event, we used it to assess capacity for very large TiDB Cloud clusters and decide how many nodes to add. The code was tied to one environment, but the method carries over. This post walks through it with made-up numbers: what to measure, how to summarize it, how much headroom to keep, and where the simple model breaks.

The examples use TiDB, but the same approach works for most distributed databases and stateless services that expose per-node metrics.

## The idea in one formula

For each component and each resource, the number of nodes you need is:

```
nodes needed = (usage per node × current node count × growth) / (capacity per node × target utilization)
```

- usage per node: a summary of how much of the resource each node uses today, such as the 99th percentile over the observation window.
- current node count × usage per node: roughly the total demand on the cluster today.
- growth: how much more traffic you expect. 1.5 means 50% more.
- capacity per node: what one node can provide, such as 32 cores or 2 TiB of disk.
- target utilization: how full you are willing to run each node. Dividing by 0.5 means you want nodes at 50% or less.

You calculate this for every resource of every component. The resource that needs the most nodes is the bottleneck, and that sets the node count for that component.

<figure>
<svg viewBox="0 30 900 110" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="cp-title cp-desc" style="display:block;width:100%;max-width:900px;height:auto;margin:0 auto;font-family:'Open Sans',sans-serif">
  <title id="cp-title">Capacity planning pipeline</title>
  <desc id="cp-desc">Prometheus usage metrics per node are summarized into percentiles, then scaled by node count and growth and divided by node capacity times target utilization, giving the nodes needed per resource; the largest result is the bottleneck and sets the node count.</desc>
  <defs>
    <marker id="cp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e51843"/></marker>
  </defs>
  <rect x="10" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="85" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">Prometheus</text>
  <text x="85" y="98" text-anchor="middle" font-size="12" fill="#555">usage per node</text>
  <rect x="197" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="272" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">Summarize</text>
  <text x="272" y="98" text-anchor="middle" font-size="12" fill="#555">p50 … p99.9, max</text>
  <rect x="384" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="459" y="72" text-anchor="middle" font-size="14" font-weight="700" fill="#222">Scale</text>
  <text x="459" y="92" text-anchor="middle" font-size="12" fill="#555">× nodes × growth</text>
  <text x="459" y="110" text-anchor="middle" font-size="12" fill="#555">/ (capacity × target)</text>
  <rect x="571" y="40" width="150" height="90" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="646" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#222">Nodes needed</text>
  <text x="646" y="98" text-anchor="middle" font-size="12" fill="#555">per resource</text>
  <rect x="758" y="40" width="132" height="90" rx="6" fill="#fde3e9" stroke="#e51843"/>
  <text x="824" y="78" text-anchor="middle" font-size="14" font-weight="700" fill="#9c0f2f">Bottleneck</text>
  <text x="824" y="98" text-anchor="middle" font-size="12" fill="#9c0f2f">largest wins</text>
  <line x1="160" y1="85" x2="195" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cp-arrow)"/>
  <line x1="347" y1="85" x2="382" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cp-arrow)"/>
  <line x1="534" y1="85" x2="569" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cp-arrow)"/>
  <line x1="721" y1="85" x2="756" y2="85" stroke="#e51843" stroke-width="2" marker-end="url(#cp-arrow)"/>
</svg>
</figure>

## Step 1: Pick the observation window

The numbers come from whatever period you query, so the period has to contain the load you are planning for.

- Cover at least one full business cycle, usually a week, so weekday and weekend patterns are both in the data.
- Make sure the window includes your known peaks: month-end batch jobs, the last sales event, the daily reporting run.
- If you are planning for a specific event, measure the most similar past event and use growth to scale it.
- Watch the query step. A long window with a large step averages away short spikes. I used a 60-second step for two days of data and 30 seconds for one day.

## Step 2: Measure usage per component and resource

A TiDB cluster has four main components. Every node runs node_exporter, so host metrics for CPU, memory, disk IOPS, disk bandwidth and network bandwidth exist for all four, and all of them should go through the calculation. Each component uses disk and network differently, though, so they tend to run out of different things:

| Component | What disk and network are used for | Usually runs out of |
|---|---|---|
| TiDB (SQL layer) | Disk: logs, and sorts and hash joins that spill when a large query runs out of memory. Network: client requests, reading from TiKV and TiFlash, returning results | CPU, memory, network bandwidth |
| TiKV (row storage) | Disk: data, Raft logs, compaction. Network: Raft replication to other replicas, serving reads and writes from TiDB | CPU, storage, disk IOPS, disk bandwidth |
| TiFlash (column storage) | Disk: columnar data and background merges. Network: replicating from TiKV, exchanging data between nodes in MPP queries | CPU, memory, storage, disk bandwidth |
| PD (placement and timestamps) | Disk: etcd for cluster metadata, sensitive to fsync latency. Network: heartbeats, TSO requests | CPU, memory, disk latency |

Disk IOPS, disk bandwidth and network bandwidth are three separate limits, and each needs its own calculation:

- Disk IOPS is the number of reads and writes per second. Small random IO hits it first, such as TiKV point lookups and RocksDB reading blocks that aren't in the cache.
- Disk bandwidth is the number of bytes read and written per second. Large sequential IO hits it first, such as compaction, range scans, TiFlash reading column files, and backups.
- Network bandwidth is the bytes per second the network interface sends and receives. On every TiKV write, the leader sends the log to the other two replicas, across availability zones. TiDB pulling data from TiKV, results going back to clients, backups and rebalancing all use the network too.

The same disk can be at 30% of its IOPS and 80% of its bandwidth, so lumping them together hides the real bottleneck.

CPU, memory and storage come from TiDB's own metrics. Disk and network come from node_exporter:

```
# CPU cores used per TiDB instance
rate(process_cpu_seconds_total{component="tidb"}[2m])

# Resident memory per TiDB instance
process_resident_memory_bytes{component="tidb"}

# Used storage per TiKV store
sum(tikv_store_size_bytes{type="used"}) by (instance)

# Used storage per TiFlash store
sum(tiflash_system_current_metric_StoreSizeUsed) by (instance)

# Disk IOPS (reads + writes)
sum(rate(node_disk_reads_completed_total{device="nvme1n1"}[1m])
  + rate(node_disk_writes_completed_total{device="nvme1n1"}[1m])) by (instance)

# Disk bandwidth in bytes per second (reads + writes)
sum(rate(node_disk_read_bytes_total{device="nvme1n1"}[1m])
  + rate(node_disk_written_bytes_total{device="nvme1n1"}[1m])) by (instance)

# Network bandwidth in bytes per second, inbound and outbound separately
sum(rate(node_network_receive_bytes_total{device="eth0"}[1m])) by (instance)
sum(rate(node_network_transmit_bytes_total{device="eth0"}[1m])) by (instance)
```

Replace `nvme1n1` and `eth0` with your actual data disk and network interface.

For per-node capacity, use the matching capacity metrics where they exist, such as `tikv_store_size_bytes{type="capacity"}` or `node_memory_MemTotal_bytes`. Otherwise use the published limits of the instance type and the volume, with a few things to watch:

- Disk IOPS and bandwidth are limited by both the volume and the instance. On AWS, for example, a gp3 volume has its own provisioned IOPS and throughput, and the instance has its own EBS bandwidth and IOPS limits. The lower of the two applies.
- Use the baseline network bandwidth. Many instance types are listed as "up to 10 Gbps", which is the burst limit; the sustained baseline is much lower.
- Keep units consistent. Network limits are usually in bits per second and the metrics are in bytes, so multiply by 8 before comparing.

Use `rate()` rather than `irate()` for CPU. `irate()` only looks at the last two samples, which is useful on a dashboard but makes percentiles over a long window noisier than they should be.

## Step 3: Summarize with percentiles, not the peak

Planning on the maximum sounds safe, but the maximum is usually a single spike: a backup, a rebalance, one bad query. Say TiDB CPU peaks at 22 cores per node while the 99th percentile is 14. Planning on the peak adds about 57% more nodes to cover a few minutes a day that the cluster already handles.

I calculate a range of statistics for every resource, from p50 to p99.9 plus the max, and decide which one to plan on:

- p99 is a sensible default for CPU, disk IOPS, disk bandwidth and network bandwidth. It ignores rare spikes but keeps the regular busy periods.
- For storage, look at the latest value and the trend rather than a percentile. Storage rarely shrinks, and next quarter's size is what matters. How to calculate the trend is covered later.
- Check what the max actually was before ignoring it. If the spike was your peak business hour rather than a one-off job, plan on it.

## Step 4: Decide how full a node may get

The target utilization is where most of the judgement goes. My first version used a single redundancy factor of 3.3 for everything, which means a target of about 30% utilization. That is easy to explain, but it treats CPU and disk as if they behaved the same way, and they don't.

Things to consider for each resource:

- Failure headroom. With nodes spread evenly across three availability zones, losing one zone moves its load onto the other two. To survive that without being overloaded, normal utilization has to stay below about two thirds, before any other headroom.
- Latency. For CPU, the useful limit is where latency starts to climb, not 100%. For many OLTP workloads that is well below full usage, so leave room for bursts.
- Background work. Storage engines need free disk for compaction, and a cluster needs space to rebalance data when a node is added or lost. A disk that is nearly full can't absorb either of them.
- TiDB memory can be treated as linear. TiDB is a stateless SQL layer. Most of its memory is allocated while queries run, for hash joins, sorts, aggregations and result sets, and released when they finish. There is no large cache that is filled up front, so memory roughly follows concurrency and query volume, and grows about as fast as traffic does. I subtract a fixed overhead from each node's capacity first (the OS, the Go runtime, the statistics cache and so on) and scale the rest. RSS also includes memory the garbage collector hasn't reclaimed yet, and large queries cause spikes, which is another reason to plan on p99 rather than the average.
- Pooled memory can't. TiKV's block cache works like MySQL's InnoDB buffer pool: it is sized by configuration and fills up over time, so memory looks steadily high no matter how much traffic there is. It reflects the configuration, not demand, so I don't plan TiKV nodes on memory. Whether the cache is big enough is a question for the hit rate.

## Step 5: Find the bottleneck

Here is a made-up TiKV example: 9 nodes spread evenly across 3 availability zones, each with 32 cores and 2,000 GiB of disk, and 50% more traffic expected next quarter. Results are rounded up to a multiple of 3; the reason is at the end of this section.

With one factor of 3.3 for every resource:

| Resource | Usage per node | Calculation | Nodes needed |
|---|---|---|---|
| CPU (p99) | 12 cores | 12 × 9 × 1.5 × 3.3 / 32 | 16.7 → 18 |
| Storage (latest) | 900 GiB | 900 × 9 × 1.5 × 3.3 / 2000 | 20.05 → 21 |

With a target per resource, CPU at 50% and storage at 70%:

| Resource | Usage per node | Calculation | Nodes needed |
|---|---|---|---|
| CPU (p99) | 12 cores | 12 × 9 × 1.5 / (32 × 0.5) | 10.1 → 12 |
| Storage (latest) | 900 GiB | 900 × 9 × 1.5 / (2000 × 0.7) | 8.7 → 9 |

The uniform factor says 21 nodes, with storage as the bottleneck. The per-resource targets say 12 nodes, with CPU as the bottleneck. The formula is the same in both cases. The difference comes entirely from the targets, so that is where to spend the time. To keep it simple, storage is multiplied by 1.5 here as well; a trend is a better way to project it, covered later.

Finally, round the result, but the rule depends on the component:

- TiKV keeps 3 replicas by default, and PD places the 3 replicas of each Region in 3 different availability zones, so each zone holds a full copy of the data. If one zone has fewer nodes, each of its nodes carries more data and more writes, and that zone caps the whole cluster. Keep the same number of nodes in every zone. TiDB Cloud Dedicated enforces this: TiKV starts at 3 nodes, and scaling adds or removes nodes in all 3 zones at the same time, so the step is 3. That is why the 10.1 nodes for CPU in the example become 12, not 11. A self-managed cluster without location labels, or with more isolation domains than replicas, doesn't have this constraint.
- TiFlash is also spread evenly across zones, with replicas set per table and at least 2 recommended for production. Keeping zones even avoids skew, but there is no strict multiple-of-3 rule as there is for TiKV.
- TiDB is stateless behind a load balancer. Use whatever number the formula gives; there is nothing to round to. If it spans availability zones, just keep at least one node in each.
- PD usually runs a fixed 3 or 5 nodes, an odd number because Raft needs a majority. It rarely scales with traffic and isn't sized with this formula.

## Where the simple model breaks

The formula assumes that doubling traffic doubles resource usage and that adding nodes spreads it evenly. Both are only roughly true.

- Hotspots. A cluster-wide percentile can look healthy while one node is saturated by a hot table or a hot key range. Look at the busiest node as well as the summary, and fix skew before buying hardware.
- Non-linear growth. Some costs grow faster than traffic: compaction under heavy writes, lock contention, cross-node transactions. Validate the plan with a load test when the growth is large.
- Burstable limits. Cloud instances often have a baseline network and disk throughput and a higher burst limit. Plan on the baseline, or you will run out of burst credits at the worst moment.
- Things that aren't hardware. Connection limits, region or shard counts, and time-oracle (PD) latency can become the limit before CPU or disk does. I paired the capacity plan with a health check that flagged these against thresholds.

## What I would add today

### Targets from SLOs

The targets above, 50% for CPU and 70% for storage, are rules of thumb. A better way is to work them out from an SLO.

First, an SLA is not an SLO. TiDB Cloud's SLA covers availability only: a probe tries to connect every minute, and a minute counts as down only if every attempt fails. Dedicated clusters with multiple nodes are committed to 99.99% a month. That is a floor. A cluster can be several times slower than usual and still meet it, so it says nothing about saturation. For capacity planning, use your own SLO, usually a latency and an error rate, such as p99 latency under 50 ms and errors under 0.1%.

The matching TiDB metrics:

```
# p99 query latency at the TiDB layer
histogram_quantile(0.99,
  sum(rate(tidb_server_handle_query_duration_seconds_bucket[1m])) by (le))

# Error rate
sum(rate(tidb_server_query_total{result="Error"}[1m]))
  / sum(rate(tidb_server_query_total[1m]))

# p99 gRPC latency at the TiKV layer, to see which layer is slow
histogram_quantile(0.99,
  sum(rate(tikv_grpc_msg_duration_seconds_bucket[1m])) by (le, type))
```

Next, find the saturation point, which answers one question: at what CPU utilization does latency break the SLO?

There are two ways to get the data. One is history: for every minute over the last few weeks, pair the CPU utilization with the p99 latency in the same minute and plot them, with CPU utilization on the x-axis and p99 latency on the y-axis. The other is a load test: raise the load step by step in a test environment, for example 10% more QPS every 10 minutes, and record CPU utilization and p99 latency at each step.

The result usually looks like the chart below. At low utilization, requests don't wait for each other and latency barely moves. Past some point, requests start to queue and latency rises steeply. Draw a horizontal line at the SLO. The CPU utilization where it meets the curve is the saturation point, and any more CPU than that breaks the SLO.

<figure>
<svg viewBox="0 0 600 305" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="sle-title sle-desc" style="display:block;width:100%;max-width:600px;height:auto;margin:0 auto;font-family:'Open Sans',sans-serif">
  <title id="sle-title">CPU utilization vs p99 latency</title>
  <desc id="sle-desc">Illustration: p99 latency stays around 10 ms until about 50% CPU, then climbs quickly and reaches the 50 ms SLO at 75%, the saturation point. Allowing for 1.5 times the load after losing one zone gives a 50% target.</desc>
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
  <text x="310" y="300" text-anchor="middle" font-size="13" fill="#222">CPU utilization</text>
  <text x="14" y="150" text-anchor="middle" font-size="13" fill="#222" transform="rotate(-90 14 150)">p99 latency</text>
  <line x1="60" y1="150" x2="560" y2="150" stroke="#9c0f2f" stroke-dasharray="6 4"/>
  <text x="556" y="143" text-anchor="end" font-size="12" fill="#9c0f2f">SLO 50 ms</text>
  <line x1="310" y1="60" x2="310" y2="260" stroke="#888" stroke-dasharray="4 4"/>
  <text x="302" y="74" text-anchor="end" font-size="12" fill="#333">target 50%</text>
  <text x="302" y="90" text-anchor="end" font-size="12" fill="#333">= 75% / 1.5</text>
  <line x1="435" y1="150" x2="435" y2="260" stroke="#e51843" stroke-dasharray="4 4"/>
  <polyline fill="none" stroke="#e51843" stroke-width="2.5" points="60,238 310,238 335,236.5 360,229.2 385,213.4 410,187.6 435,150 460,99.4 480,48.1"/>
  <circle cx="435" cy="150" r="4.5" fill="#e51843"/>
  <text x="443" y="200" font-size="12" font-weight="700" fill="#e51843">saturation 75%</text>
</svg>
</figure>

In the chart it is 75%. If one of three availability zones goes down, the other two take 50% more load, so normal utilization has to stay at or below 75% / 1.5 = 50%. That is the CPU target, and it is where the 50% in the example came from. Saturation points vary a lot between workloads. Small OLTP queries may stay flat past 80%, while queries with heavy sorts and aggregations may start to wobble at 60%, so measure each cluster.

### Storage from a trend

Storage grows with write volume and retention, not with QPS, so multiplying it by a traffic growth factor is a rough guess at best. A trend works better.

1. Take the used storage for the last 3 to 6 months, one point per day, using the daily max or average to smooth out the sawtooth from compaction. `sum(tikv_store_size_bytes{type="used"})` includes every replica, so compare it with capacity on the same basis.
2. Fit a straight line to get the slope, for example 60 GiB a day for the whole cluster. Prometheus can do this with `predict_linear()`: `predict_linear(sum(tikv_store_size_bytes{type="used"})[30d:1h], 90*86400)` gives the value 90 days from now. Most Prometheus setups keep only 15 to 30 days, though, so for a longer trend you need long-term storage such as Thanos or VictoriaMetrics, or a daily row in a table.
3. Project the usage at the planning date: future usage = current usage + slope × (days until the next review + lead time to scale). Include the lead time. New nodes need time to rebalance data, so you can't wait until the disks are nearly full.
4. Use the projected usage in the formula with a growth factor of 1, because the trend already includes the growth.

Continuing the example: the 9 TiKV nodes use 8,100 GiB in total and grow by 60 GiB a day. The plan covers 90 days, with 30 days of lead time.

```
future usage = 8,100 + 60 × (90 + 30) = 15,300 GiB
nodes needed = 15,300 / (2,000 × 0.7) = 10.9 → 12
```

The same numbers give a useful alert:

```
days until target = (total capacity × target utilization − current usage) / daily growth
```

When that number drops below your lead time, it is time to scale.

A few traps when fitting the line:

- One-off events skew the slope: bulk imports, TTL deletes, dropped tables. After a DROP TABLE the space comes back only after GC and compaction, so the curve stays flat for a while and then falls. Leave those periods out of the fit.
- Growth isn't always linear. If the weekly growth percentage is steady, the growth is compounding. Fit the logarithm of usage instead, or the projection will come out too low.

### Other things

- Per-node skew in the output, so hotspots show up in the same report as the totals.
- A schedule. Run it every week and alert when the projected node count changes, rather than running it once before each event.

## Checklist

1. Measure at least a week that includes your peaks.
2. Collect usage and capacity per component and per resource.
3. Plan on p99 for CPU and network, and on the latest value plus trend for storage.
4. Set a target utilization per resource. Work out the CPU target from your latency SLO, then allow for failure headroom and background work.
5. Calculate nodes per resource. The largest result is your bottleneck.
6. Keep TiKV nodes even across zones (a multiple of 3 on TiDB Cloud). TiDB needs no rounding.
7. Check the busiest node, and load-test large changes.
