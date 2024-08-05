---
layout: post
title: "Kubernetes Logging EFK Deployment"
date: 2024-04-02
permalink: /posts/2024/04/kubernetes-logging-efk-deployment/
category: Kubernetes 
tags: [Kubernetes, EFK, ECK, Logging]
imagefeature: cover2.jpg
comments: true
featured: true
toc: true
---
❗ This is not a production setup, it's only for testing and demo purpose 

### Envrionments
1. minikube v1.32.0 
2. Kubernetes v1.24
3. ECK v2.12
4. Elasticsearch + Kibana v8.13.0
5. Fluentd v1.16

### Introduction
This is a simple infra level logging system setup, Fluentd as a daemonset running on each Kubernetes node as an agent to collect all containers' logs to elasticseach. Again, this is not for production setup, just meet basic log collection requirement, production setup colud be more conprehensive.

<figure>
	<img src="{{ site.url }}/images/efk/efk.png" alt="efk">
	<figcaption>A glance of the architecture</figcaption>
</figure>

### Step By Step Setup
#### 1. Prepare Kubernetes
```shell
minikube start --cpus=3 --memory=6G --disk-size=25G --kubernetes-version=v1.24
```
#### 2. Deploy ECK
Refer to official documentation [Deploy ECK in your Kubernetes cluster](https://www.elastic.co/guide/en/cloud-on-k8s/2.12/k8s-deploy-eck.html)
##### 2.1 Deploy Elastic Operator
1.Create CRD
```bash
kubectl create -f https://download.elastic.co/downloads/eck/2.12.1/crds.yaml
```
2.Create Operator
```bash
kubectl apply -f https://download.elastic.co/downloads/eck/2.12.1/operator.yaml
```

##### 2.2 Deploy Elasticsearch
1.Create namespace **eck** for ECK

2.Deploy Elaisticsearch
```bash
kubectl apply -f elasticsearch.yaml
```
**elasticsearch.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/efk-deployment/elasticsearch.yaml).
<figure>
        <img src="{{ site.url }}/images/efk/es.png" alt="es" width="900">
</figure>
Make sure HEALTH is **green**, and PHASE is **Ready**.

##### 2.3 Deploy Kibana
```bash
kubectl apply -f kibana.yaml 
```
**kibana.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/efk-deployment/kibana.yaml).
<figure>
        <img src="{{ site.url }}/images/efk/kb.png" alt="kibana" width="900">
</figure>

##### 2.4 Access Kibana
1.Get password
```
kubectl get secret quickstart-es-elastic-user -n eck -o go-template='{% raw %}{{.data.elastic | base64decode}}{% endraw %}'
```
<figure>
        <img src="{{ site.url }}/images/efk/kb-secret.png" alt="kb-secret" width="900">
</figure>

2.Expose kibana service access from outside Kubernetes
```bash
kubectl port-forward service/quickstart-kb-http -n eck 5601 --address=0.0.0.0
```

3.Login
Access Kibana URL <https://{your host}:5601/>
<figure>
        <img src="{{ site.url }}/images/efk/kb-login.png" alt="kb-login" width="900">
</figure>
#### 3. Deploy Fluentd

```bash
kubectl apply -f fluentd-daemonset-elasticsearch-rbac.yaml
```
**fluentd-daemonset-elasticsearch-rbac.yaml** can be found [here](https://github.com/yinx0004/tidb-operator-logging-efk-integration-demo/blob/main/efk-deployment/fluentd-daemonset-elasticsearch-rbac.yaml).
>Replace the environment varibles accordingly, especically FLUENT_ELASTICSEARCH_PASSWORD
<figure>
        <img src="{{ site.url }}/images/efk/fluentd.png" alt="fluentd" width="900">
</figure>


#### 4. Create Data View in Kibana
<figure>
        <img src="{{ site.url }}/images/efk/es-dataview.png" alt="es-dataview" width="900">
</figure>
#### 5. View K8S Logs in Kibana 
<figure>
        <img src="{{ site.url }}/images/efk/es-view.png" alt="es-view" width="900">
</figure>

Enjoy EFK!!!
