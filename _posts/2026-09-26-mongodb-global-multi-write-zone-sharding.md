---
layout: post
title: "Building a Global Multi-Write MongoDB Cluster with Zone Sharding"
date: 2026-09-26
permalink: /posts/2026/09/mongodb-global-multi-write-zone-sharding/
category: MongoDB
tags: [MongoDB, Sharding, Zone Sharding, Multi-Region, High Availability, Disaster Recovery]
imagefeature: cover9.jpg
comments: true
featured: true
toc: true
---
Say an application has users in China and in North America. With a single replica set, the primary lives in one of the two regions, so users in the other region pay a trans-Pacific round trip, usually well over 100 ms, on every write. If the write concern waits for replication, it's more.

MongoDB has no multi-master replication. Each replica set has exactly one primary, which is also why MongoDB never has to resolve write conflicts. Zone sharding gets close to multi-region writes without giving that up. This post covers how to set it up, and what happens when a region goes down, which matters more in operations.

## How it works

A sharded cluster is made of several replica sets (shards), each with its own primary. Zone sharding pins ranges of the shard key to specific shards. Combine that with where you place replica set members:

1. Put a region field such as `homeRegion` at the front of the shard key.
2. Assign each shard to a zone, and map each region's key range to that zone.
3. Keep each shard's primary in its own region, with secondaries in the other region.

A Chinese player's documents then live on a shard whose primary is in China, and an American player's documents on a shard whose primary is in North America. Both regions write locally into the same cluster, but any single document still has exactly one primary. Most of the limitations later in this post follow from that.

## Topology

<figure>
<svg viewBox="0 0 900 540" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="topo-title topo-desc" style="display:block;width:100%;max-width:900px;height:auto;margin:0 auto;font-family:'Open Sans',sans-serif">
  <title id="topo-title">Global MongoDB cluster with zone sharding across China and North America</title>
  <desc id="topo-desc">Each region has application servers and two mongos routers. The config server replica set has its primary and one secondary in China and one secondary in North America; mongos reads routing metadata from it. Shard0 (zone APAC) has its primary and one secondary in China and one secondary in North America. Shard1 (zone NA) has its primary and one secondary in North America and one secondary in China. Each region reads and writes its own shard locally, and replication crosses regions through the oplog.</desc>
  <defs>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e51843"/></marker>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#2f5d8a"/></marker>
  </defs>
  <rect x="10" y="10" width="430" height="520" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <rect x="460" y="10" width="430" height="520" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="225" y="40" text-anchor="middle" font-size="17" font-weight="700" fill="#222">China</text>
  <text x="675" y="40" text-anchor="middle" font-size="17" font-weight="700" fill="#222">North America</text>

  <rect x="90" y="56" width="170" height="36" rx="4" fill="#fff" stroke="#888"/>
  <text x="175" y="79" text-anchor="middle" font-size="14" fill="#222">App servers</text>
  <line x1="130" y1="92" x2="90" y2="120" stroke="#555" stroke-width="1.5"/>
  <line x1="220" y1="92" x2="250" y2="120" stroke="#555" stroke-width="1.5"/>
  <rect x="40" y="120" width="100" height="36" rx="4" fill="#222"/>
  <text x="90" y="143" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>
  <rect x="200" y="120" width="100" height="36" rx="4" fill="#222"/>
  <text x="250" y="143" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>

  <rect x="640" y="56" width="170" height="36" rx="4" fill="#fff" stroke="#888"/>
  <text x="725" y="79" text-anchor="middle" font-size="14" fill="#222">App servers</text>
  <line x1="680" y1="92" x2="650" y2="120" stroke="#555" stroke-width="1.5"/>
  <line x1="770" y1="92" x2="810" y2="120" stroke="#555" stroke-width="1.5"/>
  <rect x="600" y="120" width="100" height="36" rx="4" fill="#222"/>
  <text x="650" y="143" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>
  <rect x="760" y="120" width="100" height="36" rx="4" fill="#222"/>
  <text x="810" y="143" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>

  <line x1="250" y1="156" x2="250" y2="188" stroke="#888" stroke-width="1.5" stroke-dasharray="2 3"/>
  <line x1="650" y1="156" x2="650" y2="188" stroke="#888" stroke-width="1.5" stroke-dasharray="2 3"/>
  <line x1="280" y1="210" x2="290" y2="210" stroke="#888" stroke-dasharray="4 3"/>
  <line x1="370" y1="210" x2="610" y2="210" stroke="#888" stroke-dasharray="4 3"/>
  <rect x="200" y="190" width="80" height="40" rx="4" fill="#666"/>
  <text x="240" y="215" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Config P</text>
  <rect x="290" y="190" width="80" height="40" rx="4" fill="#eee" stroke="#888"/>
  <text x="330" y="215" text-anchor="middle" font-size="12" fill="#333">Config S</text>
  <rect x="610" y="190" width="80" height="40" rx="4" fill="#eee" stroke="#888"/>
  <text x="650" y="215" text-anchor="middle" font-size="12" fill="#333">Config S</text>
  <text x="200" y="248" font-size="12" font-weight="700" fill="#555">config server replica set</text>
  <text x="610" y="248" font-size="12" font-weight="700" fill="#555">config server replica set</text>

  <line x1="90" y1="156" x2="90" y2="266" stroke="#e51843" stroke-width="2" marker-end="url(#arrow-red)"/>
  <text x="98" y="182" font-size="12" fill="#e51843">local reads</text>
  <text x="98" y="199" font-size="12" fill="#e51843">and writes</text>
  <line x1="810" y1="156" x2="810" y2="386" stroke="#2f5d8a" stroke-width="2" marker-end="url(#arrow-blue)"/>
  <text x="802" y="182" text-anchor="end" font-size="12" fill="#2f5d8a">local reads</text>
  <text x="802" y="199" text-anchor="end" font-size="12" fill="#2f5d8a">and writes</text>

  <line x1="150" y1="290" x2="165" y2="290" stroke="#e51843" stroke-dasharray="4 3"/>
  <line x1="285" y1="290" x2="490" y2="290" stroke="#e51843" stroke-dasharray="4 3"/>
  <rect x="30" y="268" width="120" height="44" rx="4" fill="#e51843"/>
  <text x="90" y="295" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">Primary</text>
  <rect x="165" y="268" width="120" height="44" rx="4" fill="#fde3e9" stroke="#e51843"/>
  <text x="225" y="295" text-anchor="middle" font-size="14" fill="#9c0f2f">Secondary</text>
  <rect x="490" y="268" width="120" height="44" rx="4" fill="#fde3e9" stroke="#e51843"/>
  <text x="550" y="295" text-anchor="middle" font-size="14" fill="#9c0f2f">Secondary</text>
  <text x="30" y="336" font-size="13" font-weight="700" fill="#e51843">shard0 · zone APAC · homeRegion "CN"</text>

  <line x1="420" y1="410" x2="615" y2="410" stroke="#2f5d8a" stroke-dasharray="4 3"/>
  <line x1="735" y1="410" x2="750" y2="410" stroke="#2f5d8a" stroke-dasharray="4 3"/>
  <rect x="300" y="388" width="120" height="44" rx="4" fill="#e3edf7" stroke="#2f5d8a"/>
  <text x="360" y="415" text-anchor="middle" font-size="14" fill="#1f3f5f">Secondary</text>
  <rect x="615" y="388" width="120" height="44" rx="4" fill="#e3edf7" stroke="#2f5d8a"/>
  <text x="675" y="415" text-anchor="middle" font-size="14" fill="#1f3f5f">Secondary</text>
  <rect x="750" y="388" width="120" height="44" rx="4" fill="#2f5d8a"/>
  <text x="810" y="415" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">Primary</text>
  <text x="870" y="456" text-anchor="end" font-size="13" font-weight="700" fill="#2f5d8a">shard1 · zone NA · homeRegion "US"</text>

  <text x="450" y="500" text-anchor="middle" font-size="13" fill="#555">dashed lines: replication across regions · dotted lines: mongos reads routing metadata</text>
</svg>
<figcaption>Each region writes to the shard whose primary is local. Secondaries in the other region hold a copy for disaster recovery and local reads. Every <code>mongos</code> gets its routing metadata from the config server replica set.</figcaption>
</figure>

A minimal two-region layout:

| Component | China | North America |
|---|---|---|
| Application servers | ✔ | ✔ |
| `mongos` routers | 2 or more | 2 or more |
| shard0 (zone `APAC`) | Primary + Secondary | Secondary |
| shard1 (zone `NA`) | Secondary | Primary + Secondary |
| Config server replica set | Primary + Secondary | Secondary (see [config servers](#config-servers)) |

Applications connect to the `mongos` routers in their own region. Run at least two per region so a router restart doesn't take the region's traffic down. `mongos` routes by shard key using metadata it caches from the config servers, so a write for a `"CN"` document goes to shard0's primary in China and never leaves the region.

## Setup

There are three parts: the data model, shard zones, and zone ranges. The commands below use the current names; `sh.addShardTag()` and `sh.addTagRange()` are the older names for the same operations. Run them through `mongos` as a user with the `clusterManager` role.

### 1. Data model and shard key

The example is player profiles in a game, stored in `game.players`. The application sets `homeRegion` when the player signs up, based on the region they pick:

```javascript
{
  _id: ObjectId("..."),
  homeRegion: "CN",            // set by the application at sign-up
  playerId: 100234,
  nickname: "lotus",
  level: 42,
  lastLoginAt: ISODate("2026-09-26T08:00:00Z"),
  inventory: [ /* ... */ ]
}
```

Zone ranges can only be defined on a prefix of the shard key, so `homeRegion` has to come first. The second field should have high cardinality and appear in your queries, so chunks can still be split within a zone:

```javascript
{ homeRegion: 1, playerId: 1 }
```

A document inserted without `homeRegion` won't end up where you expect. Schema validation is a cheap way to prevent that:

```javascript
db.createCollection("players", {
  validator: {
    $jsonSchema: {
      required: ["homeRegion", "playerId"],
      properties: { homeRegion: { enum: ["CN", "US"] } }
    }
  }
})
```

### 2. Add shards to zones

```javascript
sh.addShardToZone("shard0", "APAC")
sh.addShardToZone("shard1", "NA")
```

A shard can be in several zones, and a zone can have several shards. One shard per zone is enough to start with. Add shards to a zone when it runs out of capacity.

### 3. Define zone ranges

The lower bound is inclusive and the upper bound is exclusive. With `MinKey` and `MaxKey` on `playerId`, each range covers a whole region:

```javascript
sh.updateZoneKeyRange(
  "game.players",
  { homeRegion: "CN", playerId: MinKey },
  { homeRegion: "CN", playerId: MaxKey },
  "APAC"
)

sh.updateZoneKeyRange(
  "game.players",
  { homeRegion: "US", playerId: MinKey },
  { homeRegion: "US", playerId: MaxKey },
  "NA"
)
```

If you can, create the zones and ranges before you shard the collection. For an empty or non-existent collection, `shardCollection` then creates chunks on the zone boundaries and puts them on the right shards straight away, so the balancer doesn't have to move data across the Pacific later:

```javascript
sh.enableSharding("game")
sh.shardCollection("game.players", { homeRegion: 1, playerId: 1 })
```

For an existing collection, the balancer migrates every chunk that sits in the wrong zone. Across regions that's a lot of traffic, so run it inside a balancing window.

### 4. Keep each primary in its home region

Zones decide which shard owns a document. Replica set configuration decides where that shard's primary runs. Set priorities and tags so the primary is elected in the home region:

```javascript
// on shard0 (home: China)
cfg = rs.conf()
cfg.members[0].priority = 2;   cfg.members[0].tags = { region: "cn" }
cfg.members[1].priority = 1;   cfg.members[1].tags = { region: "cn" }
cfg.members[2].priority = 0.5; cfg.members[2].tags = { region: "us" }
rs.reconfig(cfg)
```

Don't set the remote member's priority to 0. A priority-0 member can never become primary, so it couldn't take over if the home region went down.

### 5. Check routing

```javascript
sh.status()                                   // zones, ranges, chunk placement
db.players.getShardDistribution()             // data per shard
db.players.find({ homeRegion: "CN", playerId: 100234 }).explain()
                                              // should target only shard0
```

## Reads

Reads of a region's own data go to the local primary, which covers most traffic.

For data that belongs to the other region, there are two options. Reading from the primary is consistent, but it crosses the ocean. Reading from a local secondary is fast but may be stale: use `readPreference: "nearest"` (or `"secondaryPreferred"`) with a region tag such as `readPreferenceTags=region:cn`. Set `maxStalenessSeconds` (at least 90) so the driver skips secondaries that have fallen too far behind.

A query without `homeRegion` can't be targeted, so `mongos` sends it to every shard in both regions. A support tool that looks up player 100234 by `playerId` alone runs a global query every time. Keep `homeRegion` in the filter of every frequent query.

## Write concern and region failure

Zone sharding makes writes local. Whether those writes survive the loss of a region depends on where the write concern's majority comes from. You can't have local writes, zero data loss, and automatic failover at the same time. There are two common layouts.

### Layout A: 2 members at home, 1 remote

`w: "majority"` needs 2 of 3 acknowledgements, and both can come from the home region, so writes stay local.

If the home region goes down, the remote member is 1 of 3 and can't be elected. Someone has to force a reconfiguration by hand, and whatever hadn't replicated across the ocean yet is lost. That replication lag is your RPO.

### Layout B: 5 members across 3 regions (2 + 2 + 1)

A majority is 3, so at least one acknowledgement has to come from outside the home region. Every majority write pays at least one cross-region round trip. Putting the fifth member in a region close to home keeps that cost small.

If the home region goes down, the other 3 members still form a majority and elect a new primary on their own. No acknowledged majority write is lost.

| | Layout A (2 + 1) | Layout B (2 + 2 + 1) |
|---|---|---|
| Write latency with `w: "majority"` | local | at least one cross-region round trip |
| Home region lost: automatic failover | ✘ manual forced reconfig | ✔ |
| Home region lost: acknowledged writes lost | possible (replication lag) | none |
| Cost | 3 nodes per shard | 5 nodes per shard, 3 regions |

A common split is layout A for most data, accepting a small RPO, and layout B for data where losing a write isn't acceptable. Either is fine, as long as your runbook matches the layout you actually deployed.

## Config servers

The config server replica set stores chunk ownership, zones, and ranges. If it loses its primary, reads and writes keep working with the routing table `mongos` already has, but chunk migrations, splits, and `shardCollection` stop until a primary is back.

With two regions, one of them has to hold the config servers' majority. In the diagram that's China, with two of the three members, so losing China freezes metadata changes. That's usually acceptable during an incident. A small third region fixes it for the config servers, and it's also where layout B's fifth member lives.

## Failure scenarios

| Scenario | What happens | What to plan |
|---|---|---|
| Cross-region link down | Each region keeps writing its own shard locally. Replication to remote secondaries lags, and remote reads get staler. | Alert on replication lag, and watch oplog window size so secondaries can catch up without a full resync. |
| One member in the home region down | The other members still form a majority, and writes continue. | Normal replica set operations. |
| Whole home region down (layout A) | That zone's data is read-only elsewhere, and it has no primary. | A runbook for forced reconfiguration, with the RPO it implies written down in advance. |
| Whole home region down (layout B) | A new primary is elected in another region, and writes continue with higher latency. | Capacity in the surviving regions to absorb the extra load. |
| Player travels temporarily | Requests route from the local `mongos` to the home shard's primary across the ocean: slower, but correct. | Nothing. Travel is rare, so accept the latency. |
| Player moves to another region | Their documents stay pinned to the old zone until the shard key changes. | Update `homeRegion` (see below). |

### Players who travel

Most region changes are trips. A North American player visiting China keeps `homeRegion: "US"`. Their app connects to the `mongos` in China, which sends every read and write to shard1's primary in North America. Each request crosses the Pacific, so it's slower, but it's correct and no data moves.

This doesn't happen often, so I'd accept the latency rather than build anything for it. Reads that can tolerate some staleness can use `readPreference: "nearest"`. Writes still go to the home primary.

### Players who move

Only a permanent move is worth moving data for. Changing a shard key value moves the document to another shard. MongoDB allows it under a few conditions: the update runs through `mongos`, as a retryable write or inside a transaction, with an equality match on the full shard key, one document at a time (`updateOne`, not `updateMany`):

```javascript
session.withTransaction(() => {
  players.updateOne(
    { homeRegion: "CN", playerId: 100234 },
    { $set: { homeRegion: "US" } }
  )
})
```

If the player also has documents in other zoned collections, like match history or friend lists, it becomes a small migration job. Decide whether old data needs to move at all, or only new data.

## Limitations

- There's no global uniqueness. On a sharded collection, a unique index has to be prefixed by the shard key, so you can make an email unique per region but not worldwide. A global registry needs a separate design, for example a small unzoned collection or an external service.
- A transaction that touches both zones is a distributed transaction across the Pacific. Keep transactions within one region.
- Chunks outside every zone range can end up on any shard. Make sure every `homeRegion` value is covered by a range.
- Remote secondaries are full copies of the other region's data. If the reason for pinning data is data residency rather than latency, this layout breaks it, and DR members would have to stay inside the allowed jurisdiction.
- Zone sharding doesn't apply to time series collections. The balancer always spreads them evenly across all shards.
- Dropping a collection also drops its zone ranges. Recreate them, ideally before sharding the collection again.

## Alternative: independent clusters with two-way sync

The other common approach skips the shared cluster. Each region runs its own independent MongoDB deployment, a replica set or a sharded cluster, and a tool such as [MongoShake](https://github.com/alibaba/MongoShake) replicates changes in both directions.

<figure>
<svg viewBox="0 0 900 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="shake-title shake-desc" style="display:block;width:100%;max-width:900px;height:auto;margin:0 auto;font-family:'Open Sans',sans-serif">
  <title id="shake-title">Two-way sync between regional clusters with two MongoShake instances</title>
  <desc id="shake-desc">China and North America each run an independent MongoDB cluster holding a full copy of the data. MongoShake instance A fetches China's oplog with its Collector, filters it, and replays it through the Direct tunnel into North America. MongoShake instance B does the same from North America to China. Each instance saves its checkpoint in its source database. Loop filtering by gid is only available in Alibaba Cloud's internal version.</desc>
  <defs>
    <marker id="shk-red" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e51843"/></marker>
    <marker id="shk-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#2f5d8a"/></marker>
  </defs>

  <rect x="10" y="10" width="220" height="420" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="120" y="40" text-anchor="middle" font-size="17" font-weight="700" fill="#222">China</text>
  <rect x="40" y="60" width="160" height="36" rx="4" fill="#fff" stroke="#888"/>
  <text x="120" y="83" text-anchor="middle" font-size="14" fill="#222">App servers</text>
  <line x1="120" y1="96" x2="120" y2="114" stroke="#555" stroke-width="1.5"/>
  <rect x="40" y="114" width="160" height="36" rx="4" fill="#222"/>
  <text x="120" y="137" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>
  <line x1="120" y1="150" x2="120" y2="180" stroke="#555" stroke-width="1.5"/>
  <rect x="18" y="180" width="204" height="150" rx="4" fill="#fff" stroke="#e51843"/>
  <text x="120" y="202" text-anchor="middle" font-size="13" font-weight="700" fill="#e51843">Independent cluster</text>
  <rect x="26" y="216" width="60" height="36" rx="4" fill="#e51843"/>
  <text x="56" y="238" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">Primary</text>
  <rect x="90" y="216" width="60" height="36" rx="4" fill="#fde3e9" stroke="#e51843"/>
  <text x="120" y="238" text-anchor="middle" font-size="11" fill="#9c0f2f">Secondary</text>
  <rect x="154" y="216" width="60" height="36" rx="4" fill="#fde3e9" stroke="#e51843"/>
  <text x="184" y="238" text-anchor="middle" font-size="11" fill="#9c0f2f">Secondary</text>
  <text x="120" y="310" text-anchor="middle" font-size="12" fill="#555">full copy of all data</text>

  <rect x="670" y="10" width="220" height="420" rx="6" fill="#fafafa" stroke="#d0d0d0"/>
  <text x="780" y="40" text-anchor="middle" font-size="17" font-weight="700" fill="#222">North America</text>
  <rect x="700" y="60" width="160" height="36" rx="4" fill="#fff" stroke="#888"/>
  <text x="780" y="83" text-anchor="middle" font-size="14" fill="#222">App servers</text>
  <line x1="780" y1="96" x2="780" y2="114" stroke="#555" stroke-width="1.5"/>
  <rect x="700" y="114" width="160" height="36" rx="4" fill="#222"/>
  <text x="780" y="137" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">mongos</text>
  <line x1="780" y1="150" x2="780" y2="180" stroke="#555" stroke-width="1.5"/>
  <rect x="678" y="180" width="204" height="150" rx="4" fill="#fff" stroke="#2f5d8a"/>
  <text x="780" y="202" text-anchor="middle" font-size="13" font-weight="700" fill="#2f5d8a">Independent cluster</text>
  <rect x="686" y="216" width="60" height="36" rx="4" fill="#2f5d8a"/>
  <text x="716" y="238" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">Primary</text>
  <rect x="750" y="216" width="60" height="36" rx="4" fill="#e3edf7" stroke="#2f5d8a"/>
  <text x="780" y="238" text-anchor="middle" font-size="11" fill="#1f3f5f">Secondary</text>
  <rect x="814" y="216" width="60" height="36" rx="4" fill="#e3edf7" stroke="#2f5d8a"/>
  <text x="844" y="238" text-anchor="middle" font-size="11" fill="#1f3f5f">Secondary</text>
  <text x="780" y="310" text-anchor="middle" font-size="12" fill="#555">full copy of all data</text>

  <rect x="250" y="70" width="400" height="130" rx="6" fill="#fff" stroke="#e51843" stroke-dasharray="6 4"/>
  <text x="450" y="94" text-anchor="middle" font-size="13" font-weight="700" fill="#e51843">MongoShake A · China → North America</text>
  <rect x="275" y="112" width="100" height="36" rx="4" fill="#f5b731"/>
  <text x="325" y="135" text-anchor="middle" font-size="13" font-weight="700" fill="#3d2c00">Collector</text>
  <rect x="400" y="112" width="100" height="36" rx="4" fill="#f1f1f1" stroke="#999"/>
  <text x="450" y="135" text-anchor="middle" font-size="13" fill="#333">Filter</text>
  <rect x="525" y="112" width="100" height="36" rx="4" fill="#ec5fa3"/>
  <text x="575" y="135" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">Direct</text>
  <line x1="375" y1="130" x2="398" y2="130" stroke="#e51843" stroke-width="1.5" marker-end="url(#shk-red)"/>
  <line x1="500" y1="130" x2="523" y2="130" stroke="#e51843" stroke-width="1.5" marker-end="url(#shk-red)"/>
  <text x="450" y="178" text-anchor="middle" font-size="11" fill="#555">checkpoint saved in the China cluster</text>
  <path d="M222 205 H240 V130 H273" fill="none" stroke="#e51843" stroke-width="2" marker-end="url(#shk-red)"/>
  <text x="257" y="123" text-anchor="middle" font-size="11" fill="#e51843">fetch</text>
  <path d="M625 130 H660 V205 H676" fill="none" stroke="#e51843" stroke-width="2" marker-end="url(#shk-red)"/>
  <text x="642" y="123" text-anchor="middle" font-size="11" fill="#e51843">replay</text>

  <rect x="250" y="230" width="400" height="130" rx="6" fill="#fff" stroke="#2f5d8a" stroke-dasharray="6 4"/>
  <text x="450" y="254" text-anchor="middle" font-size="13" font-weight="700" fill="#2f5d8a">MongoShake B · North America → China</text>
  <rect x="275" y="272" width="100" height="36" rx="4" fill="#ec5fa3"/>
  <text x="325" y="295" text-anchor="middle" font-size="13" font-weight="700" fill="#fff">Direct</text>
  <rect x="400" y="272" width="100" height="36" rx="4" fill="#f1f1f1" stroke="#999"/>
  <text x="450" y="295" text-anchor="middle" font-size="13" fill="#333">Filter</text>
  <rect x="525" y="272" width="100" height="36" rx="4" fill="#f5b731"/>
  <text x="575" y="295" text-anchor="middle" font-size="13" font-weight="700" fill="#3d2c00">Collector</text>
  <line x1="525" y1="290" x2="502" y2="290" stroke="#2f5d8a" stroke-width="1.5" marker-end="url(#shk-blue)"/>
  <line x1="400" y1="290" x2="377" y2="290" stroke="#2f5d8a" stroke-width="1.5" marker-end="url(#shk-blue)"/>
  <text x="450" y="338" text-anchor="middle" font-size="11" fill="#555">checkpoint saved in the North America cluster</text>
  <line x1="678" y1="290" x2="627" y2="290" stroke="#2f5d8a" stroke-width="2" marker-end="url(#shk-blue)"/>
  <text x="652" y="282" text-anchor="middle" font-size="11" fill="#2f5d8a">fetch</text>
  <line x1="275" y1="290" x2="224" y2="290" stroke="#2f5d8a" stroke-width="2" marker-end="url(#shk-blue)"/>
  <text x="249" y="282" text-anchor="middle" font-size="11" fill="#2f5d8a">replay</text>

  <text x="450" y="392" text-anchor="middle" font-size="11" fill="#555">Filter: namespace whitelist / blacklist. Loop filtering by gid is only</text>
  <text x="450" y="408" text-anchor="middle" font-size="11" fill="#555">available in Alibaba Cloud's internal version of MongoShake.</text>
</svg>
<figcaption>Two MongoShake instances, one per direction. Component names follow MongoShake's <a href="https://github.com/alibaba/MongoShake">architecture overview</a>.</figcaption>
</figure>

MongoShake replicates in one direction, so two-way sync means two instances: one for China → North America and one for North America → China. Each instance fetches the source oplog with its Collector. For a sharded source, it connects to every shard, preferably reading from secondaries. It filters namespaces with whitelists and blacklists, and replays the changes into the target `mongos` through the Direct tunnel. It saves a checkpoint, by default in the source database, so it can resume after a restart, and it exposes metrics through a REST API and Prometheus.

Every region can write every document and holds a full copy of the data.

### Pros

- The regions are isolated from each other. They share no config servers, elections, or balancer, so an outage or network partition in one region never blocks writes in the other.
- Every document can be read and written locally in every region. There's no region field in the shard key, no zone ranges, no relocation, and no queries broadcast across regions.
- Each side can run a different topology, version, or hardware, and filters can keep some data out of a region.
- It's easy to add to an existing single-region deployment: stand up a second cluster and start syncing, the same way many migrations are done.

### Cons

- Conflicts. If a document is updated in both regions within the sync lag, each side applies the other's change after its own, and the two copies can end up permanently different. MongoShake doesn't resolve conflicts, so the application has to make sure each document is only written in one region. That's the same rule zone sharding enforces, except here nothing enforces it.
- Duplicate keys. Two players registering the same email in both regions at once both succeed locally. Replaying one of them then hits a duplicate key error, and the sync either stalls or drops the change, depending on configuration.
- It's asynchronous only. There's no cross-region write concern, so a region failure loses whatever was inside the sync lag, and cross-region reads are eventually consistent.
- Loops. Each instance has to tell local writes from replicated ones, or changes bounce back and forth. MongoShake does this with a gid, but its README says gid is only available in Alibaba Cloud's internal version, because it needs MongoDB kernel changes. The open-source version can't filter loops that way, and the [FAQ](https://github.com/alibaba/MongoShake/wiki/FAQ) describes workarounds.
- Transactions and DDL. Multi-document transactions can be replayed as individual writes, so the target briefly sees half a transaction. MongoShake only syncs DDL when the source is a replica set.
- More to operate. The sync instances need their own high availability, monitoring, upgrades, and checkpoint handling. If one falls behind past the oplog window, you have to do a full resync. You also need a regular way to check the two sides for drift.
- Every region stores all the data: double the storage, and the same data residency problem as remote secondaries.
- No vendor support. MongoShake is a third-party tool, and MongoDB's own Cluster-to-Cluster Sync (`mongosync`) only does one-way replication.

### Comparison

| | Zone sharding (one cluster) | Independent clusters + two-way sync |
|---|---|---|
| Who can write a document | only its home shard's primary | any region |
| Write conflicts | impossible by design | possible; the application must avoid them |
| Cross-region durability | tunable with write concern (layout A / B) | async only; RPO = sync lag |
| Region failure | depends on member placement | other region unaffected |
| Global unique indexes | not possible (shard key prefix rule) | not possible; cross-region duplicates break sync |
| Data per region | own zone + remote replicas | full copy |
| Operational burden | sharding, balancer, config servers | two clusters plus a sync pipeline |
| Support | built into MongoDB | third-party tools |

Zone sharding enforces single ownership in the database, so you can't break it by accident. Two-way sync isolates the regions better and is more flexible, but it moves conflict avoidance and consistency checks into the application and into operations. If the data already has a natural home region, I'd choose zone sharding. Two-way sync makes more sense when regional isolation is the top priority and the application can guarantee that each document is only written in one region.

## When zone sharding fits

It works well when data has a natural home region, most traffic stays in that region, and you can accept either a small RPO (layout A) or slower writes (layout B) when a region fails.

It works badly for documents written from several regions at once, like a global counter or a shared document. Every write still goes to one primary, so for most users that document is remote no matter how you zone it. Global uniqueness or cross-region transactions on the hot path are also a bad fit.

On Atlas, Global Clusters provide the same setup as a managed feature. It's still zone sharding underneath, and the same write concern trade-offs apply.

## References

- [MongoDB Manual: Zones](https://www.mongodb.com/docs/manual/core/zone-sharding/)
- [Segmenting Data by Location](https://www.mongodb.com/docs/manual/tutorial/sharding-segmenting-data-by-location/)
- [`sh.updateZoneKeyRange()`](https://www.mongodb.com/docs/manual/reference/method/sh.updateZoneKeyRange/)
- [Change a Document's Shard Key Value](https://www.mongodb.com/docs/manual/core/sharding-change-shard-key-value/)
- [MongoShake](https://github.com/alibaba/MongoShake)
