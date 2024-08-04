---
title: "TiDB Operator Logging EFK Integration - Part II TiDB Logging Integrate with EFK"
date: 2024-04-01
permalink: /posts/2024/04/tidb-operator-logging-efk-integration-part-II/
category: TiDB
tags: [TiDB, TiDB Operator, EFK, ECK]
imagefeature: cover6.jpg
comments: true
featured: true
---
❗ This is not a production setup, it's only for testing and demo purpose 

### Introduction
This is the Part II of the series, demonstrate how to collect TiDB logs to EFK, this is depends on the [Part I](/posts/2024/04/tidb-operator-logging-efk-integration-part-I) 


### Step by Step Setup
#### 1. Deploy TiDB Operator
```bash
kubectl create -f https://raw.githubusercontent.com/pingcap/tidb-operator/v1.5.2/manifests/crd.yaml
kubectl create namespace tidb-admin
helm install --namespace tidb-admin tidb-operator pingcap/tidb-operator --version v1.5.2
```

#### 2. Deploy TiDB Cluster with Basic Logging Integration
Since TiDB components deployed by TiDB Operator output the logs in the stdout and stderr of the container by default, all the TiDB components logs will be collected by Fluentd running on each Kubernetes node. 
<figure>
        <img src="{{ site.url }}/images/integration.png" alt="integraton" width="900">
</figure>


##### 2.1 Deploy TiDB Basic Cluster
1. Cluster manifest `basic.yaml`
```yaml
# basic.yaml
# IT IS NOT SUITABLE FOR PRODUCTION USE.
# This YAML describes a basic TiDB cluster with minimum resource requirements,
# which should be able to run in any Kubernetes cluster with storage support.
apiVersion: pingcap.com/v1alpha1
kind: TidbCluster
metadata:
  name: basic
spec:
  version: v7.5.0
  timezone: UTC
  pvReclaimPolicy: Retain
  enableDynamicConfiguration: true
  configUpdateStrategy: RollingUpdate
  discovery: {}
  helper:
    image: alpine:3.16.0
  pd:
    baseImage: pingcap/pd
    maxFailoverCount: 0
    replicas: 1
    # if storageClassName is not set, the default Storage Class of the Kubernetes cluster will be used
    # storageClassName: local-storage
    requests:
      storage: "1Gi"
    config: {}
  tikv:
    baseImage: pingcap/tikv
    maxFailoverCount: 0
    # If only 1 TiKV is deployed, the TiKV region leader
    # cannot be transferred during upgrade, so we have
    # to configure a short timeout
    evictLeaderTimeout: 1m
    replicas: 1
    # if storageClassName is not set, the default Storage Class of the Kubernetes cluster will be used
    # storageClassName: local-storage
    requests:
      storage: "1Gi"
    config:
      storage:
        # In basic examples, we set this to avoid using too much storage.
        reserve-space: "0MB"
      rocksdb:
        # In basic examples, we set this to avoid the following error in some Kubernetes clusters:
        # "the maximum number of open file descriptors is too small, got 1024, expect greater or equal to 82920"
        max-open-files: 256
      raftdb:
        max-open-files: 256
  tidb:
    baseImage: pingcap/tidb
    maxFailoverCount: 0
    replicas: 1
    service:
      type: ClusterIP
    config: {}
```
2. Deploy cluster
```bash
kubectl create namespace tidb-cluster
kubectl apply -f basic.yaml -n tidb-cluster
```
##### 2.2 View TiDB Logs in Kibana
<figure>
        <img src="{{ site.url }}/images/tidb-log1.png" alt="log1" width="900">
</figure>

<figure>
        <img src="{{ site.url }}/images/tidb-log2.png" alt="log2" width="900">
</figure>

#### 3. Deploy TiDB Cluster with Customized Logging Integration
Fluent bit running as sidecar in TiDB pod, you can use Fluentd as well. Here I choose Fluent bit as it's light weight.

<figure>
        <img src="{{ site.url }}/images/fluent-bit.png" alt="fluent-bit" width="900">
</figure>

##### 3.1 Prepare Fluent bit config
For demo purpose, I will manually mount Fluent bit config. You may customize your image for a clean deployment, as slow query log is multiline format, you may need to handle it properly, mutiline format parser is skipped here

1.ConfigMap manifest `tidb-fluentbit-cm.yaml`
```yaml
# tidb-fluentbit-cm.yaml
kind: ConfigMap
apiVersion: v1
metadata:
  namespace: tidb-cluster
  name: tidb-fluentbit
data:
  fluent-bit.conf: |
    [INPUT]
        Name  tail
        Path  /var/log/tidb/*
        Tag   tidb
        Read_from_Head  True

    [OUTPUT]
        Name  es
        Match  *
        Host  quickstart-es-http.eck
        Port  9200
        Index  tidb
        tls  On
        tls.verify  Off
        HTTP_User  elastic
        HTTP_Passwd  12667swmP7CB86GFHHTVd79s
        Logstash_Format  On
        Logstash_Prefix  tidb
        Suppress_Type_Name  On

    [OUTPUT]
        name  stdout
        match   *
```

2.Create fluentbit ConfigMap
```bash
kubectl apply -f tidb-fluentbit-cm.yaml
```
<figure>
        <img src="{{ site.url }}/images/fluent-bit-cm.png" alt="fluent-bit-cm" width="900">
</figure>

##### 3.2 Deploy TiDB Cluster with Fluent-bit as sidecar container
###### Option 1: 3 containers
This deployment will keep the default slowlog container, fluent-bit as an additional container, tidb pod in total 3 containers.

1.Cluster manif `advanced-cluster.yaml`
```yaml
# advanced-cluster.yaml
apiVersion: pingcap.com/v1alpha1
kind: TidbCluster
metadata:
  name: advanced-test
  namespace: tidb-cluster
spec:
  version: "v7.5.0"
  timezone: UTC
  configUpdateStrategy: RollingUpdate
  helper:
    image: alpine:3.16.0
    imagePullPolicy: IfNotPresent
  pvReclaimPolicy: Retain
  enableDynamicConfiguration: true
  pd:
    baseImage: pingcap/pd
    config: |
      [dashboard]
        internal-proxy = true
    replicas: 1
    maxFailoverCount: 0
    requests:
      storage: 1Gi
    mountClusterClientSecret: true
  tidb:
    baseImage: pingcap/tidb
    config: |
      [performance]
        tcp-keep-alive = true
      [log]
        slow-threshold = 0  # for demo purpose
    replicas: 1
    maxFailoverCount: 0
    service:
      type: ClusterIP
    additionalContainers:
    - name: fluent-bit
      image: fluent/fluent-bit:1.7
      imagePullPolicy: IfNotPresent
      command: ['/fluent-bit/bin/fluent-bit', '-c', '/fluent-bit/etc/fluent-bit.conf']
      volumeMounts:
        - name: slowlog
          mountPath: /var/log/tidb
        - name: fluent-bit-config
          mountPath: /fluent-bit/etc/
    additionalVolumes:
    - name: fluent-bit-config
      configMap:
        name: tidb-fluentbit
  tikv:
    baseImage: pingcap/tikv
    config: |
      log-level = "info"
    replicas: 1
    maxFailoverCount: 0
    requests:
      storage: 5Gi
    mountClusterClientSecret: true
```

2.Deploy cluster
```bash
kubectl apply -f advanced-cluster.yaml
```
<figure>
        <img src="{{ site.url }}/images/advanced-cluster.png" alt="advanced-cluster" width="900">
</figure>
```bash
kubectl describe po advanced-test-tidb-0 -n tidb-cluster
Name:             advanced-test-tidb-0
Namespace:        tidb-cluster
Priority:         0
Service Account:  default
Node:             minikube/192.168.49.2
Start Time:       Sun, 07 Apr 2024 01:17:19 +0800
Labels:           app.kubernetes.io/component=tidb
                  app.kubernetes.io/instance=advanced-test
                  app.kubernetes.io/managed-by=tidb-operator
                  app.kubernetes.io/name=tidb-cluster
                  controller-revision-hash=advanced-test-tidb-5b4dd75db8
                  statefulset.kubernetes.io/pod-name=advanced-test-tidb-0
                  tidb.pingcap.com/cluster-id=7354318695080032400
Annotations:      prometheus.io/path: /metrics
                  prometheus.io/port: 10080
                  prometheus.io/scrape: true
Status:           Running
IP:               10.244.1.16
IPs:
  IP:           10.244.1.16
Controlled By:  StatefulSet/advanced-test-tidb
Containers:
  slowlog:
    Container ID:  docker://f08c1bec0b07f503753c09d4a9e9b8534f50597a91e3b0546e0e2e5b1674cbe3
    Image:         alpine:3.16.0
    Image ID:      docker-pullable://alpine@sha256:686d8c9dfa6f3ccfc8230bc3178d23f84eeaf7e457f36f271ab1acc53015037c
    Port:          <none>
    Host Port:     <none>
    Command:
      sh
      -c
      touch /var/log/tidb/slowlog; tail -n0 -F /var/log/tidb/slowlog;
    State:          Running
      Started:      Sun, 07 Apr 2024 01:17:19 +0800
    Ready:          True
    Restart Count:  0
    Environment:    <none>
    Mounts:
      /var/log/tidb from slowlog (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-5f7qm (ro)
  tidb:
    Container ID:  docker://0c056cf2d202b9e3c8532162ab9dfc757046743a37d01c57e1d3131006ba534e
    Image:         pingcap/tidb:v7.5.0
    Image ID:      docker-pullable://pingcap/tidb@sha256:4a0f3070b27a5acf9734e16c725050ae95b4a07b58ac08693c596ce237045a1f
    Ports:         4000/TCP, 10080/TCP
    Host Ports:    0/TCP, 0/TCP
    Command:
      /bin/sh
      /usr/local/bin/tidb_start_script.sh
    State:          Running
      Started:      Sun, 07 Apr 2024 01:17:20 +0800
    Ready:          True
    Restart Count:  0
    Readiness:      tcp-socket :4000 delay=10s timeout=1s period=10s #success=1 #failure=3
    Environment:
      CLUSTER_NAME:           advanced-test
      TZ:                     UTC
      BINLOG_ENABLED:         false
      SLOW_LOG_FILE:          /var/log/tidb/slowlog
      POD_NAME:               advanced-test-tidb-0 (v1:metadata.name)
      NAMESPACE:              tidb-cluster (v1:metadata.namespace)
      HEADLESS_SERVICE_NAME:  advanced-test-tidb-peer
    Mounts:
      /etc/podinfo from annotations (ro)
      /etc/tidb from config (ro)
      /usr/local/bin from startup-script (ro)
      /var/log/tidb from slowlog (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-5f7qm (ro)
  fluent-bit:
    Container ID:  docker://a303e150cb6cee7a497149e8123a11917145b65ba8d9bb02ace9d5306484eee8
    Image:         fluent/fluent-bit:1.7
    Image ID:      docker-pullable://fluent/fluent-bit@sha256:c3fe3469d3bc6459e701a32d66a592cf1a88304f850ea94dfd0405dfef9152d8
    Port:          <none>
    Host Port:     <none>
    Command:
      /fluent-bit/bin/fluent-bit
      -c
      /fluent-bit/etc/fluent-bit.conf
    State:          Running
      Started:      Sun, 07 Apr 2024 01:17:20 +0800
    Ready:          True
    Restart Count:  0
    Environment:    <none>
    Mounts:
      /fluent-bit/etc/ from fluent-bit-config (rw)
      /var/log/tidb from slowlog (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-5f7qm (ro)
Conditions:
  Type              Status
  Initialized       True
  Ready             True
  ContainersReady   True
  PodScheduled      True
Volumes:
  annotations:
    Type:  DownwardAPI (a volume populated by information about the pod)
    Items:
      metadata.annotations -> annotations
  config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      advanced-test-tidb-6564616
    Optional:  false
  startup-script:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      advanced-test-tidb-6564616
    Optional:  false
  slowlog:
    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)
    Medium:
    SizeLimit:  <unset>
  fluent-bit-config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      tidb-fluentbit
    Optional:  false
  kube-api-access-5f7qm:
    Type:                    Projected (a volume that contains injected data from multiple sources)
    TokenExpirationSeconds:  3607
    ConfigMapName:           kube-root-ca.crt
    ConfigMapOptional:       <nil>
    DownwardAPI:             true
QoS Class:                   BestEffort
Node-Selectors:              <none>
Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s
Events:
  Type    Reason     Age   From               Message
  ----    ------     ----  ----               -------
  Normal  Scheduled  10m   default-scheduler  Successfully assigned tidb-cluster/advanced-test-tidb-0 to minikube
  Normal  Pulled     10m   kubelet            Container image "alpine:3.16.0" already present on machine
  Normal  Created    10m   kubelet            Created container slowlog
  Normal  Started    10m   kubelet            Started container slowlog
  Normal  Pulled     10m   kubelet            Container image "pingcap/tidb:v7.5.0" already present on machine
  Normal  Created    10m   kubelet            Created container tidb
  Normal  Started    10m   kubelet            Started container tidb
  Normal  Pulled     10m   kubelet            Container image "fluent/fluent-bit:1.7" already present on machine
  Normal  Created    10m   kubelet            Created container fluent-bit
  Normal  Started    10m   kubelet            Started container fluent-bit
```
<figure>
        <img src="{{ site.url }}/images/tc.png" alt="tc" width="900">
</figure>
```bash
kubectl logs advanced-test-tidb-0 -c fluent-bit -n tidb-cluster |less
```
<figure>
        <img src="{{ site.url }}/images/tc-logs.png" alt="tc-logs" width="900">
</figure>

###### Option2: Fluent-bit Merged with default slowlog container  
We customize the default slowlog container to run Fluent bit by merging the default slowlog container and additional container.
tidb pod only 2 containers

1.Cluster manifest `advanced-cluster-fluentbit-merged.yaml`
```yaml
# advanced-cluster-fluentbit-merged.yaml
apiVersion: pingcap.com/v1alpha1
kind: TidbCluster
metadata:
  name: advanced-test
  namespace: tidb-cluster
spec:
  version: "v7.5.0"
  timezone: UTC
  configUpdateStrategy: RollingUpdate
  #helper:
  #  image: alpine:3.16.0
  #  imagePullPolicy: IfNotPresent
  pvReclaimPolicy: Retain
  enableDynamicConfiguration: true
  pd:
    baseImage: pingcap/pd
    config: |
      [dashboard]
        internal-proxy = true
    replicas: 1
    maxFailoverCount: 0
    requests:
      storage: 1Gi
    mountClusterClientSecret: true
  tidb:
    baseImage: pingcap/tidb
    config: |
      [performance]
        tcp-keep-alive = true
      [log]
        slow-threshold = 0
    replicas: 1
    maxFailoverCount: 0
    service:
      type: ClusterIP
    additionalContainers:
    - name: slowlog
      image: fluent/fluent-bit:1.7
      imagePullPolicy: IfNotPresent
      command: ['/fluent-bit/bin/fluent-bit', '-c', '/fluent-bit/etc/fluent-bit.conf']
      volumeMounts:
        - name: slowlog
          mountPath: /var/log/tidb
        - name: fluent-bit-config
          mountPath: /fluent-bit/etc/
    additionalVolumes:
    - name: fluent-bit-config
      configMap:
        name: tidb-fluentbit
  tikv:
    baseImage: pingcap/tikv
    config: |
      log-level = "info"
    replicas: 1
    maxFailoverCount: 0
    requests:
      storage: 5Gi
    mountClusterClientSecret: true
```

```bash
kubectl apply -f advanced-cluster-fluentbit-merged.yaml
```
<figure>
        <img src="{{ site.url }}/images/tc-merged.png" alt="tc-merged" width="900">
</figure>

```yaml
$ kubectl describe po advanced-test-tidb-0 -n tidb-cluster
Name:             advanced-test-tidb-0
Namespace:        tidb-cluster
Priority:         0
Service Account:  default
Node:             minikube/192.168.49.2
Start Time:       Sun, 07 Apr 2024 01:45:49 +0800
Labels:           app.kubernetes.io/component=tidb
                  app.kubernetes.io/instance=advanced-test
                  app.kubernetes.io/managed-by=tidb-operator
                  app.kubernetes.io/name=tidb-cluster
                  controller-revision-hash=advanced-test-tidb-794cd4b948
                  statefulset.kubernetes.io/pod-name=advanced-test-tidb-0
                  tidb.pingcap.com/cluster-id=7354318695080032400
Annotations:      prometheus.io/path: /metrics
                  prometheus.io/port: 10080
                  prometheus.io/scrape: true
Status:           Running
IP:               10.244.1.24
IPs:
  IP:           10.244.1.24
Controlled By:  StatefulSet/advanced-test-tidb
Containers:
  slowlog:
    Container ID:  docker://9860734bc529db02e74f745281e49b566874e7a45e180c7c8141a9c18490fa16
    Image:         fluent/fluent-bit:1.7
    Image ID:      docker-pullable://fluent/fluent-bit@sha256:c3fe3469d3bc6459e701a32d66a592cf1a88304f850ea94dfd0405dfef9152d8
    Port:          <none>
    Host Port:     <none>
    Command:
      /fluent-bit/bin/fluent-bit
      -c
      /fluent-bit/etc/fluent-bit.conf
    State:          Running
      Started:      Sun, 07 Apr 2024 01:45:50 +0800
    Ready:          True
    Restart Count:  0
    Environment:    <none>
    Mounts:
      /fluent-bit/etc/ from fluent-bit-config (rw)
      /var/log/tidb from slowlog (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-rw5bb (ro)
  tidb:
    Container ID:  docker://ad2fd61887a0ba2482175b4cac02fe8f3f3e2459dbd124f9c30ae197213b14a9
    Image:         pingcap/tidb:v7.5.0
    Image ID:      docker-pullable://pingcap/tidb@sha256:4a0f3070b27a5acf9734e16c725050ae95b4a07b58ac08693c596ce237045a1f
    Ports:         4000/TCP, 10080/TCP
    Host Ports:    0/TCP, 0/TCP
    Command:
      /bin/sh
      /usr/local/bin/tidb_start_script.sh
    State:          Running
      Started:      Sun, 07 Apr 2024 01:45:50 +0800
    Ready:          True
    Restart Count:  0
    Readiness:      tcp-socket :4000 delay=10s timeout=1s period=10s #success=1 #failure=3
    Environment:
      CLUSTER_NAME:           advanced-test
      TZ:                     UTC
      BINLOG_ENABLED:         false
      SLOW_LOG_FILE:          /var/log/tidb/slowlog
      POD_NAME:               advanced-test-tidb-0 (v1:metadata.name)
      NAMESPACE:              tidb-cluster (v1:metadata.namespace)
      HEADLESS_SERVICE_NAME:  advanced-test-tidb-peer
    Mounts:
      /etc/podinfo from annotations (ro)
      /etc/tidb from config (ro)
      /usr/local/bin from startup-script (ro)
      /var/log/tidb from slowlog (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-rw5bb (ro)
Conditions:
  Type              Status
  Initialized       True
  Ready             True
  ContainersReady   True
  PodScheduled      True
Volumes:
  annotations:
    Type:  DownwardAPI (a volume populated by information about the pod)
    Items:
      metadata.annotations -> annotations
  config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      advanced-test-tidb-6564616
    Optional:  false
  startup-script:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      advanced-test-tidb-6564616
    Optional:  false
  slowlog:
    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)
    Medium:
    SizeLimit:  <unset>
  fluent-bit-config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      tidb-fluentbit
    Optional:  false
  kube-api-access-rw5bb:
    Type:                    Projected (a volume that contains injected data from multiple sources)
    TokenExpirationSeconds:  3607
    ConfigMapName:           kube-root-ca.crt
    ConfigMapOptional:       <nil>
    DownwardAPI:             true
QoS Class:                   BestEffort
Node-Selectors:              <none>
Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s
Events:
  Type    Reason     Age    From               Message
  ----    ------     ----   ----               -------
  Normal  Scheduled  4m30s  default-scheduler  Successfully assigned tidb-cluster/advanced-test-tidb-0 to minikube
  Normal  Pulled     4m29s  kubelet            Container image "fluent/fluent-bit:1.7" already present on machine
  Normal  Created    4m29s  kubelet            Created container slowlog
  Normal  Started    4m29s  kubelet            Started container slowlog
  Normal  Pulled     4m29s  kubelet            Container image "pingcap/tidb:v7.5.0" already present on machine
  Normal  Created    4m29s  kubelet            Created container tidb
  Normal  Started    4m29s  kubelet            Started container tidb
```

```bash
 kubectl logs advanced-test-tidb-0 -c slowlog -n tidb-cluster |less
```
<figure>
        <img src="{{ site.url }}/images/tidb-logs2.png" alt="tidb-logs2" width="900">
</figure>

##### 3.3 View TiDB Slow Query Logs in Kibana
1.You will find tidb-yyyy.mm.dd index
<figure>
        <img src="{{ site.url }}/images/kibana-tidb-log-index.png" alt="es-operator" width="900">
</figure>

2.Create data view for tidb index
<figure>
        <img src="{{ site.url }}/images/kibana-tidb-slowlog-view.png" alt="es-operator" width="900">
</figure>

<figure>
        <img src="{{ site.url }}/images/kibana-tidb-logs.png" alt="es-operator" width="900">
</figure>

### Appendix
#### 1. Fluent-bit Multiline Parser for slowlog configmap
>Require at least fluent-bit v1.8

`tidb-fluentbit-cm-slowlog.yaml`
```yaml
kind: ConfigMap
apiVersion: v1
metadata:
  namespace: tidb-cluster
  name: tidb-fluentbit
data:
  fluent-bit.conf: |
    [SERVICE]
        flush        1
        Daemon       off
        log_level    trace
        parsers_file parsers_multiline.conf

    [INPUT]
        Name  tail
        Path  /var/log/tidb/*
        Tag   tidb
        Read_from_Head  True
        multiline.parser multiline-regex-slowlog

    [FILTER]
        Name record_modifier
        Match *
        Record pod ${HOSTNAME}
        Record tidb ${ADVANCED_TEST_TIDB_PORT_10080_TCP}

    [OUTPUT]
        Name  es
        Match  *
        Host  quickstart-es-http.eck
        Port  9200
        Index  tidb
        tls  On
        tls.verify  Off
        HTTP_User  elastic
        HTTP_Passwd  12667swmP7CB86GFHHTVd79s
        Logstash_Format  On
        Logstash_Prefix  tidb
        Suppress_Type_Name  On

    [OUTPUT]
        name  stdout
        match   *

  parsers_multiline.conf: |
    [MULTILINE_PARSER]
        name          multiline-regex-slowlog
        type          regex
        flush_timeout 1000
        # Regex rules for multiline parsing
        # ---------------------------------
        #
        # configuration hints:
        #
        #  - first state always has the name: start_state
        #  - every field in the rule must be inside double quotes
        #
        # rules   |   state name   | regex pattern                                    | next state name
        # --------|----------------|--------------------------------------------------|----------------
        rule         "start_state"   "/# Time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*/"  "cont"
        rule         "cont"          "/# (?!Time: )/"                                   "cont"
        rule         "cont"          "/^(?!#)/"                                         "cont"
```

Kinbana example
<figure>
        <img src="{{ site.url }}/images/kb-example1.png" alt="kb-example1" width="900">
</figure>
<figure>
        <img src="{{ site.url }}/images/kb-example2.png" alt="kb-example2" width="900">
</figure>


