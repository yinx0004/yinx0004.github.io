---
title: "TiDB Operator Logging EFK Integration"
date: 2024-04-07
permalink: /posts/2024/04/tidb-operator-logging-efk-integration/
category: TiDB
tags: [TiDB, TiDB Operator, EFK, ECK, Kubernetes]
imagefeature: cover6.jpg
comments: true
featured: true
---
❗ This is not a production setup, it's only for testing and demo purpose 

### Introduction
Since TiDB components deployed by TiDB Operator output the logs in the **stdout** and **stderr** of the container by default, as long as you have EFK deployed in your Kubernetes cluster, all the TiDB components logs will be collected by Fluentd running on each Kubernetes node, you can find TiDB logs same as other Kubernetes serviceslogs.
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/integration.png" alt="integraton" width=600>
</figure>

This article demonstrates how to collect TiDB logs using `Fluent-bit` in Kubernetes based on EFK, especially for **slow logs** which need to be properly formated before streaming to EFK, for the EFK deployment please refer to my previous blog [Kubernetes Logging EFK Deployment]({{ site.url }}/posts/2024/04/kubernetes-logging-efk-deployment/) 

### Enviornments 
1. Fluent-bit v1.8 (needed by multiline parser)
2. TiDB operator v1.5.2
3. TiDB v7.5

### Step by Step Setup
#### 1. Deploy TiDB Operator
```bash
kubectl create -f https://raw.githubusercontent.com/pingcap/tidb-operator/v1.5.2/manifests/crd.yaml
```
```bash
kubectl create namespace tidb-admin
```
```bash
helm repo add pingcap https://charts.pingcap.org/
```
```bash
helm install --namespace tidb-admin tidb-operator pingcap/tidb-operator --version v1.5.2
```

#### 2. Deploy TiDB Cluster with Fluent-bit
Fluent bit running as sidecar in TiDB pod, you can use Fluentd as well. I choose fluent-bit as it's light weight.

<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/fluent-bit.png" alt="fluent-bit" width="900">
</figure>

##### 2.1 Prepare Fluent bit config
For demo purpose, I will manually mount Fluent-bit config. You may customize your image for a clean deployment, as slow query log is multiline format, we need to handle it properly, mutiline format parser is included in the config.

1.Create fluent-bit ConfigMap
```bash
kubectl apply -f tidb-fluentbit-cm-slowlog.yaml 
```
**tidb-fluentbit-cm-slowlog.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/tidb-operator-logging/tidb-fluentbit-cm-slowlog.yaml).

##### 2.2 Deploy TiDB Cluster with fluent-bit as sidecar container
###### Option 1: fluent-bit in additional container 
This deployment will keep the default slowlog container, fluent-bit as an additional container, tidb pod in total 3 containers.

```bash
kubectl apply -f tidb-advanced-cluster-additional-container.yaml 
```
**tidb-advanced-cluster-additional-container.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/tidb-operator-logging/tidb-advanced-cluster-additional-container.yaml).
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/advanced-cluster.png" alt="advanced-cluster" width="900">
</figure>
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/tc.png" alt="tc" width="900">
</figure>

###### Option2: Fluent-bit Merged with default slowlog container  
We customize the default slowlog container to run Fluent bit by merging the default slowlog container and additional container.
tidb pod only 2 containers


```bash
kubectl apply -f tidb-advanced-cluster-fluentbit-merged-with-slowlog.yaml 
```
**tidb-advanced-cluster-fluentbit-merged-with-slowlog.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/tidb-operator-logging/tidb-advanced-cluster-fluentbit-merged-with-slowlog.yaml).
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/tc-merged.png" alt="tc-merged" width="900">
</figure>

##### 3 View TiDB Slow Query Logs in Kibana
1.You will find tidb-yyyy.mm.dd index
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/kibana-tidb-log-index.png" alt="es-operator" width="900">
</figure>

2.Create data view for tidb index
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/kibana-tidb-slowlog-view.png" alt="es-operator" width="900">
</figure>

3.View TiDB Slow Logs
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/kb-example1.png" alt="kb-example1" width="900">
</figure>
4.Formated TiDB Slow Log
<figure>
        <img src="{{ site.url }}/images/tidb-operator-logging/kb-example2.png" alt="kb-example2" width="900">
</figure>


