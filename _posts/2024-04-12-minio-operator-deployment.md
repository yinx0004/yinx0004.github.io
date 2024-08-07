---
layout: post
title: 'S3 Compatable MinIO Operator Deployment'
date: 2024-04-12
permalink: /posts/2024/04/minio-operator-deployment/
category: [Kubernetes, S3]
tags: [S3, MinIO, MinIO Operator, Kubernetes]
comments: true
featured: false
imagefeature: cover2.jpg
---
Object store service is a common service nowdays, especially S3 compatible. The introduction of MinIO can be found [here](https://min.io/).

This article will demostrate how to setup MinIO Operator for testing purpose, this is **NOT** a comprehensive guide for production scenario.
1. Deploy MinIO Operator
2. Deploy MinIO Tenant
3. Create bucket in MinIO Console

### Depoly MinIO Operator
We use Helm to deploy the operator.

```bash
helm repo add minio-operator https://operator.min.io
helm install --namespace minio-operator  --create-namespace operator minio-operator/operator
```

### Deploy MinIO Tenant
1.Download tenant CR file tenant-values.yaml
```bash
curl -sLo tenant-values.yaml https://raw.githubusercontent.com/minio/operator/master/helm/tenant/values.yaml
```
2.Configure Tenant
Update tenant-values.yaml

```yaml
tenant:
  name: myminio
  image:
    repository: quay.io/minio/minio
    tag: RELEASE.2024-07-16T23-46-41Z
    pullPolicy: IfNotPresent
  imagePullSecret: { }
  scheduler: { }
  configuration:
    name: myminio-env-configuration
    configSecret:
      name: myminio-env-configuration
      accessKey: minio
      secretKey: minio123
  pools:
    - servers: 1
      name: pool-0
      volumesPerServer: 1
      size: 10Gi
      storageAnnotations: { }
      annotations: { }
      labels: { }
      tolerations: [ ]
      nodeSelector: { }
      affinity: { }
      resources: { }
      securityContext:
        runAsUser: 1000
        runAsGroup: 1000
        fsGroup: 1000
        fsGroupChangePolicy: "OnRootMismatch"
        runAsNonRoot: true
      containerSecurityContext:
        runAsUser: 1000
        runAsGroup: 1000
        runAsNonRoot: true
        allowPrivilegeEscalation: false
        capabilities:
          drop:
            - ALL
        seccompProfile:
          type: RuntimeDefault
      topologySpreadConstraints: [ ]
  mountPath: /export
  subPath: /data
  metrics:
    enabled: false
    port: 9000
    protocol: http
  certificate:
    externalCaCertSecret: [ ]
    externalCertSecret: [ ]
    requestAutoCert: true
    certConfig: { }
  features:
    bucketDNS: false
    domains: { }
    enableSFTP: false
  buckets: [ ]
  users: [ ]
  podManagementPolicy: Parallel
  liveness: { }
  readiness: { }
  startup: { }
  lifecycle: { }
  exposeServices: { }
  serviceAccountName: ""
  prometheusOperator: false
  logging: { }
  serviceMetadata: { }
  env: [ ]
  priorityClassName: ""
  additionalVolumes: [ ]
  additionalVolumeMounts: [ ]

ingress:
  api:
    enabled: false
    ingressClassName: ""
    labels: { }
    annotations: { }
    tls: [ ]
    host: minio.local
    path: /
    pathType: Prefix
  console:
    enabled: true
    ingressClassName: ""
    labels: { }
    annotations: { }
    tls: [ ]
    host: minio-console.local
    path: /
    pathType: Prefix
```
3.Deploy tenant
```bash
helm install  --namespace myminio --create-namespace --values tenant-values.yaml myminio minio-operator/tenant
```
4.Expose console service
```bash
kubectl port-forward svc/myminio-console 9443 -n myminio --address=0.0.0.0
```
5.Access MinIO console and create bucket
- Username: minio    (accessKey)
- Password: minio123 (secretKey)
<figure>
        <img src="{{ site.url }}/images/minio-operator/minio-login.png" alt="minio-login" width=600>
</figure>

<figure>
        <img src="{{ site.url }}/images/minio-operator/create-bucket.png" alt="create-bucket" width=600>
</figure>
