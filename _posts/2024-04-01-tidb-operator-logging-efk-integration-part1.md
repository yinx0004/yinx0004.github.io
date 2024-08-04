---
title: "TiDB Operator Logging EFK Integration - Part I EFK Deployment"
date: 2024-04-01
permalink: /posts/2024/04/tidb-operator-logging-efk-integration-part-I/
category: TiDB
tags: [TiDB, TiDB Operator, EFK, ECK]
imagefeature: cover2.jpg
comments: true
featured: true
---
❗ This is not a production setup, it's only for testing and demo purpose 

This series contain two parts, I will demonstrate different ways to collect TiDB logs for TiDB Operator deployment, using TiDB slow query log as an example.

### Envrionments Used
#### Part I - EFK Deployment
1. minikube v1.32.0 
2. Kubernetes v1.24
3. ECK v2.12
4. Elasticsearch + Kibana v8.13.0
5. Fluentd v1.16

#### Part II - TiDB Logging Integrate with EFK
6. Fluent-bit v1.7
7. TiDB operator v1.5.2
8. TiDB v7.5

### Introduction
This is the Part I of the series, a simple infra level logging system setup, Fluentd as a daemonset running on each Kubernetes node as an agent to collect all containers' logs to elasticseach. Again, this is not for production setup, just meet basic log collection requirement, production setup colud be more conprehensive.

<figure>
	<img src="{{ site.url }}/images/efk.png" alt="efk">
	<figcaption>A glance of the architecture</figcaption>
</figure>

### Step By Step Setup
#### 1. Prepare Kubernetes
```shell
minikube start --cpus=3 --memory=6G --disk-size=25G --kubernetes-version=v1.24
```
#### 2. Deploy ECK
Refer to official documentation  <https://www.elastic.co/guide/en/cloud-on-k8s/2.12/k8s-deploy-eck.html>
##### 2.1 Deploy Elastic Operator
```bash
kubectl create -f https://download.elastic.co/downloads/eck/2.12.1/crds.yaml
kubectl apply -f https://download.elastic.co/downloads/eck/2.12.1/operator.yaml
```

<figure>
        <img src="{{ site.url }}/images/es-operator.png" alt="es-operator" width="900">
</figure>

##### 2.2 Deploy Elasticsearch
1. Create namespace for ECK
```bash
kubectl create ns eck
```
2. Deploy Elaisticsearch
```bash
cat <<EOF | kubectl apply -f -
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: quickstart
  namespace: eck
spec:
  version: 8.13.0
  nodeSets:
  - name: default
    count: 1
    config:
      node.store.allow_mmap: false
EOF
```
<figure>
        <img src="{{ site.url }}/images/es.png" alt="es" width="900">
</figure>
>Make sure HEALTH is green, and PHASE is Ready.

##### 2.3 Deploy Kibana
```bash
cat <<EOF | kubectl apply -f -
apiVersion: kibana.k8s.elastic.co/v1
kind: Kibana
metadata:
  name: quickstart
  namespace: eck
spec:
  version: 8.13.0
  count: 1
  elasticsearchRef:
    name: quickstart
EOF
```
<figure>
        <img src="{{ site.url }}/images/kb.png" alt="kibana" width="900">
</figure>

##### 2.4 Login Kibana
1.Get password
```bash
kubectl get secret quickstart-es-elastic-user -n eck -o go-template='{{.data.elastic | base64decode}}'
```
<figure>
        <img src="{{ site.url }}/images/kb-secret.png" alt="kb-secret" width="900">
</figure>
2.Expose kibana service access from outside Kubernetes
```bash
kubectl port-forward service/quickstart-kb-http -n eck 5601 --address=0.0.0.0
```
Access Kibana URL <https://{your host}:5601/>
<figure>
        <img src="{{ site.url }}/images/kb-login.png" alt="kb-login" width="900">
</figure>
#### 3. Deploy Fluentd
Prepare fluentd-daemonset-elasticsearch-rbac.yaml
```plaintext
#fluentd-daemonset-elasticsearch-rbac.yaml
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fluentd
  namespace: kube-system

---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: fluentd
rules:
- apiGroups:
  - ""
  resources:
  - pods
  - namespaces
  verbs:
  - get
  - list
  - watch

---
kind: ClusterRoleBinding
apiVersion: rbac.authorization.k8s.io/v1
metadata:
  name: fluentd
roleRef:
  kind: ClusterRole
  name: fluentd
  apiGroup: rbac.authorization.k8s.io
subjects:
- kind: ServiceAccount
  name: fluentd
  namespace: kube-system
---
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluentd
  namespace: kube-system
  labels:
    k8s-app: fluentd-logging
    version: v1
spec:
  selector:
    matchLabels:
      k8s-app: fluentd-logging
      version: v1
  template:
    metadata:
      labels:
        k8s-app: fluentd-logging
        version: v1
    spec:
      serviceAccount: fluentd
      serviceAccountName: fluentd
      tolerations:
      - key: node-role.kubernetes.io/control-plane
        effect: NoSchedule
      - key: node-role.kubernetes.io/master
        effect: NoSchedule
      containers:
      - name: fluentd
        image: fluent/fluentd-kubernetes-daemonset:v1-debian-elasticsearch
        env:
          - name: K8S_NODE_NAME
            valueFrom:
              fieldRef:
                fieldPath: spec.nodeName
          - name:  FLUENT_ELASTICSEARCH_HOST
            value: "quickstart-es-http.eck" 
          - name:  FLUENT_ELASTICSEARCH_PORT
            value: "9200"
          - name: FLUENT_ELASTICSEARCH_SCHEME
            value: "https"
          # Option to configure elasticsearch plugin with self signed certs
          # ================================================================
          - name: FLUENT_ELASTICSEARCH_SSL_VERIFY
            value: "false"
          # Option to configure elasticsearch plugin with tls
          # ================================================================
          - name: FLUENT_ELASTICSEARCH_SSL_VERSION
            value: "TLSv1_2"
          # X-Pack Authentication
          # =====================
          - name: FLUENT_ELASTICSEARCH_USER
            value: "elastic"
          - name: FLUENT_ELASTICSEARCH_PASSWORD
            value: "12667swmP7CB86GFHHTVd79s" # replace it
        resources:
          limits:
            memory: 200Mi
          requests:
            cpu: 100m
            memory: 200Mi
        volumeMounts:
        - name: varlog
          mountPath: /var/log
        - name: dockercontainerlogdirectory
          mountPath: /var/lib/docker/containers
          readOnly: true
      terminationGracePeriodSeconds: 30
      volumes:
      - name: varlog
        hostPath:
          path: /var/log
      - name: dockercontainerlogdirectory
        hostPath:
          path: /var/lib/docker/containers
```
>Replace the environment varibles accordingly, especically FLUENT_ELASTICSEARCH_PASSWORD

```bash
kubectl apploy -f fluentd-daemonset-elasticsearch-rbac.yaml
```
<figure>
        <img src="{{ site.url }}/images/fluentd.png" alt="fluentd" width="900">
</figure>


#### 4. Create Data View in Kibana
<figure>
        <img src="{{ site.url }}/images/es-dataview.png" alt="es-dataview" width="900">
</figure>

<figure>
        <img src="{{ site.url }}/images/es-view.png" alt="es-view" width="900">
</figure>
