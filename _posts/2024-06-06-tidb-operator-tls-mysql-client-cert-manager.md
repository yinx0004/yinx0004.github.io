---
layout: post
title: 'TiDB Operator Enable TLS For MySQL Client With cert-manager'
date: 2024-06-06
permalink: /posts/2024/06/tidb-operator-tls-mysql-cleint-cert-manager/
toc: true
category: [TiDB, Kubernetes]
tags: [TiDB, TiDB Operator, TLS, Kubernetes]
comments: true
featured: false 
imagefeature: cover4.jpg
---
TiDB Operatior supports enable and disable TLS for MySQL client for an existing TiDB cluster. This article will show you how to enable it.
Certificates can be issued by **cfssl** and **cert-manager**, here I will choose the cloud native way *cert-manager*.
1. We need a self-signed CA
2. Use the CA to sign certificate for TiDB cluster

### Prepare CA
#### Install cert-manager
```bash
helm repo add jetstack https://charts.jetstack.io --force-update
helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace --version v1.15.2 --set crds.enabled=true
```
It will take some time, be patient.

#### Prepare Issuers
TiDB is not a internet facing public services, self-signed issuer and CA is enough.
There's no naming restrictions for the issuers for TiDB Operator.
<br/>
1.Create tidb-server-issuer.yaml

```yaml
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: tidb-selfsigned-ca-issuer
  namespace: 
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: tidb-ca
  namespace: tidb-cluster
spec:
  secretName: tidb-ca-secret                  # specify a secret to store the CA certificate and private key
  commonName: "TiDB CA"
  isCA: true                                  # Make this certificate is valid for certificate signing
  duration: 87600h # 10yrs
  renewBefore: 720h # 30d
  issuerRef:
    name: tidb-selfsigned-ca-issuer           # Must specify an issuer for the certificate, we want a CA certificate, the issuer should be self-signed issuer
    kind: Issuer
---
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: tidb-issuer                           # This is the issuer issues TLS certificates for the TiDB cluster
  namespace: tidb-cluster
spec:
  ca:
    secretName: tidb-ca-secret
```

2.Create Issuers
```bash
kubectl apply -f tidb-server-issuer.yaml
```
```bash
kubectl get issuer -n tidb-cluster
```
Output:
```plain
NAMESPACE      NAME                        READY   AGE
tidb-cluster   tidb-issuer                 True    18s
tidb-cluster   tidb-selfsigned-ca-issuer   True    18s
```

### Enable TiDB Cluster TLS for Client
#### Perpare Server Certificates
We need to issue two sets of certificates:
- A set of server-side certificates for TiDB server
- A set of client-side certificates for MySQL client. 
>Certificate and keys will be stored in secrets, ${cluster_name}-tidb-server-secret and ${cluster_name}-tidb-client-secrete.
>
>The Secret objects you created must follow the above naming convention. Otherwise, the deployment of the TiDB cluster will fail.

1.Create tidb-server-cert.yaml

```bash
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: advanced-test-tidb-server-secret
  namespace: tidb-cluster
spec:
  secretName: advanced-test-tidb-server-secret
  duration: 8760h # 365d
  renewBefore: 360h # 15d
  subject:
    organizations:
    - Sherry Yin Xi
  commonName: "TiDB Server"
  usages:
    - server auth
  dnsNames:
    - "advanced-test-tidb"
    - "advanced-test-tidb.tidb-cluster"
    - "advanced-test-tidb.tidb-cluster.svc"
    - "*.advanced-test-tidb"
    - "*.advanced-test-tidb.tidb-cluster"
    - "*.advanced-test-tidb.tidb-cluster.svc"
    - "*.advanced-test-tidb-peer"
    - "*.advanced-test-tidb-peer.tidb-cluster"
    - "*.advanced-test-tidb-peer.tidb-clsuter.svc"
  ipAddresses:
    - 127.0.0.1
    - ::1
  issuerRef:
    name: tidb-issuer
    kind: Issuer
    group: cert-manager.io
```

2.Issue Certificate for TiDB Server
```bash
kubectl apply -f tidb-server-cert.yaml
```

#### Perpare Client Certificates
1.Create tidb-client-cert.yaml

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: advanced-test-tidb-client-secret
  namespace: tidb-cluster
spec:
  secretName: advanced-test-tidb-client-secret
  duration: 8760h # 365d
  renewBefore: 360h # 15d
  subject:
    organizations:
    - Sherry Yin Xi
  commonName: "TiDB Client"
  usages:
    - client auth
  issuerRef:
    name: tidb-issuer
    kind: Issuer
    group: cert-manager.io
```

2.Issue Cerficate for MySQL Client

```bash
kubectl apply -f tidb-client-cert.yaml
```

3.Other Client Components
Please refer to official [documentaiton](https://docs.pingcap.com/tidb-in-kubernetes/v1.5/enable-tls-for-mysql-client#using-cert-manager).

#### Enable TLS for Client
For an existing TiDB cluster, just update your tidb cluster manifest set `.spec.tidb.tlsClient.enabled` to `true` as below.
```yaml
spec:
...
  tidb:
    ...
    tlsClient:                  
      enabled: true             
  ...
```
After apply the above changes, the **tidb** and **pd** pods of your TiDB cluster will rolling restart.

<br/>
Check the logs of PD and TiDB pods
```bash
kubectl logs advanced-test-pd-0 -n tidb-cluster |grep -i tls
[2024/06/06 02:37:20.061 +00:00] [INFO] [server.go:249] ["PD config"] [config="{\"client-urls\":\"http://0.0.0.0:2379\",\"peer-urls\":\"http://0.0.0.0:2380\",\"advertise-client-urls\":\"http://advanced-test-pd-0.advanced-test-pd-peer.tidb-cluster.svc:2379\",\"advertise-peer-urls\":\"http://advanced-test-pd-0.advanced-test-pd-peer.tidb-cluster.svc:2380\",\"name\":\"advanced-test-pd-0\",\"data-dir\":\"/var/lib/pd\",\"force-new-cluster\":false,\"enable-grpc-gateway\":true,\"initial-cluster\":\"advanced-test-pd-0=http://advanced-test-pd-0.advanced-test-pd-peer.tidb-cluster.svc:2380\",\"initial-cluster-state\":\"new\",\"initial-cluster-token\":\"pd-cluster\",\"join\":\"\",\"lease\":3,\"log\":{\"level\":\"info\",\"format\":\"text\",\"disable-timestamp\":false,\"file\":{\"filename\":\"\",\"max-size\":0,\"max-days\":0,\"max-backups\":0},\"development\":false,\"disable-caller\":false,\"disable-stacktrace\":false,\"disable-error-verbose\":true,\"sampling\":null,\"error-output-path\":\"\"},\"max-concurrent-tso-proxy-streamings\":5000,\"tso-proxy-recv-from-client-timeout\":\"1h0m0s\",\"tso-save-interval\":\"3s\",\"tso-update-physical-interval\":\"50ms\",\"enable-local-tso\":false,\"metric\":{\"job\":\"advanced-test-pd-0\",\"address\":\"\",\"interval\":\"15s\"},\"schedule\":{\"max-snapshot-count\":64,\"max-pending-peer-count\":64,\"max-merge-region-size\":20,\"max-merge-region-keys\":0,\"split-merge-interval\":\"1h0m0s\",\"switch-witness-interval\":\"1h0m0s\",\"enable-one-way-merge\":\"false\",\"enable-cross-table-merge\":\"true\",\"patrol-region-interval\":\"10ms\",\"max-store-down-time\":\"30m0s\",\"max-store-preparing-time\":\"48h0m0s\",\"leader-schedule-limit\":4,\"leader-schedule-policy\":\"count\",\"region-schedule-limit\":2048,\"witness-schedule-limit\":4,\"replica-schedule-limit\":64,\"merge-schedule-limit\":8,\"hot-region-schedule-limit\":4,\"hot-region-cache-hits-threshold\":3,\"store-limit\":{},\"tolerant-size-ratio\":0,\"low-space-ratio\":0.8,\"high-space-ratio\":0.7,\"region-score-formula-version\":\"v2\",\"scheduler-max-waiting-operator\":5,\"enable-remove-down-replica\":\"true\",\"enable-replace-offline-replica\":\"true\",\"enable-make-up-replica\":\"true\",\"enable-remove-extra-replica\":\"true\",\"enable-location-replacement\":\"true\",\"enable-debug-metrics\":\"false\",\"enable-joint-consensus\":\"true\",\"enable-tikv-split-region\":\"true\",\"schedulers-v2\":[{\"type\":\"balance-region\",\"args\":null,\"disable\":false,\"args-payload\":\"\"},{\"type\":\"balance-leader\",\"args\":null,\"disable\":false,\"args-payload\":\"\"},{\"type\":\"balance-witness\",\"args\":null,\"disable\":false,\"args-payload\":\"\"},{\"type\":\"hot-region\",\"args\":null,\"disable\":false,\"args-payload\":\"\"},{\"type\":\"transfer-witness-leader\",\"args\":null,\"disable\":false,\"args-payload\":\"\"}],\"schedulers-payload\":null,\"hot-regions-write-interval\":\"10m0s\",\"hot-regions-reserved-days\":7,\"max-movable-hot-peer-size\":512,\"enable-diagnostic\":\"true\",\"enable-witness\":\"false\",\"slow-store-evicting-affected-store-ratio-threshold\":0.3,\"store-limit-version\":\"v1\"},\"replication\":{\"max-replicas\":3,\"location-labels\":\"\",\"strictly-match-label\":\"false\",\"enable-placement-rules\":\"true\",\"enable-placement-rules-cache\":\"false\",\"isolation-level\":\"\"},\"pd-server\":{\"use-region-storage\":\"true\",\"max-gap-reset-ts\":\"24h0m0s\",\"key-type\":\"table\",\"runtime-services\":\"\",\"metric-storage\":\"\",\"dashboard-address\":\"auto\",\"trace-region-flow\":\"true\",\"flow-round-by-digit\":3,\"min-resolved-ts-persistence-interval\":\"1s\",\"server-memory-limit\":0,\"server-memory-limit-gc-trigger\":0.7,\"enable-gogc-tuner\":\"false\",\"gc-tuner-threshold\":0.6,\"block-safe-point-v1\":\"false\"},\"cluster-version\":\"0.0.0\",\"labels\":{},\"quota-backend-bytes\":\"8GiB\",\"auto-compaction-mode\":\"periodic\",\"auto-compaction-retention-v2\":\"1h\",\"TickInterval\":\"500ms\",\"ElectionInterval\":\"3s\",\"PreVote\":true,\"max-request-bytes\":157286400,\"security\":{\"cacert-path\":\"\",\"cert-path\":\"\",\"key-path\":\"\",\"cert-allowed-cn\":null,\"SSLCABytes\":null,\"SSLCertBytes\":null,\"SSLKEYBytes\":null,\"redact-info-log\":false,\"encryption\":{\"data-encryption-method\":\"plaintext\",\"data-key-rotation-period\":\"168h0m0s\",\"master-key\":{\"type\":\"plaintext\",\"key-id\":\"\",\"region\":\"\",\"endpoint\":\"\",\"path\":\"\"}}},\"label-property\":null,\"WarningMsgs\":null,\"DisableStrictReconfigCheck\":false,\"HeartbeatStreamBindInterval\":\"1m0s\",\"LeaderPriorityCheckInterval\":\"1m0s\",\"dashboard\":{\"tidb-cacert-path\":\"/var/lib/tidb-client-tls/ca.crt\",\"tidb-cert-path\":\"/var/lib/tidb-client-tls/tls.crt\",\"tidb-key-path\":\"/var/lib/tidb-client-tls/tls.key\",\"public-path-prefix\":\"\",\"internal-proxy\":true,\"enable-telemetry\":false,\"enable-experimental\":false},\"replication-mode\":{\"replication-mode\":\"majority\",\"dr-auto-sync\":{\"label-key\":\"\",\"primary\":\"\",\"dr\":\"\",\"primary-replicas\":0,\"dr-replicas\":0,\"wait-store-timeout\":\"1m0s\",\"pause-region-split\":\"false\"}},\"keyspace\":{\"pre-alloc\":null,\"wait-region-split\":true,\"wait-region-split-timeout\":\"30s\",\"check-region-split-interval\":\"50ms\"},\"controller\":{\"degraded-mode-wait-duration\":\"0s\",\"ltb-max-wait-duration\":\"30s\",\"request-unit\":{\"read-base-cost\":0.125,\"read-per-batch-base-cost\":0.5,\"read-cost-per-byte\":0.0000152587890625,\"write-base-cost\":1,\"write-per-batch-base-cost\":1,\"write-cost-per-byte\":0.0009765625,\"read-cpu-ms-cost\":0.3333333333333333}}}"]
```

```bash
kubectl logs advanced-test-tidb-0 -c tidb -n tidb-cluster |grep tidb-server-tls
[2024/06/06 03:38:53.325 +00:00] [INFO] [printer.go:52] ["loaded config"] [config="{\"host\":\"0.0.0.0\",\"advertise-address\":\"advanced-test-tidb-0.advanced-test-tidb-peer.tidb-cluster.svc\",\"port\":4000,\"cors\":\"\",\"store\":\"tikv\",\"path\":\"advanced-test-pd:2379\",\"socket\":\"/tmp/tidb-4000.sock\",\"lease\":\"45s\",\"split-table\":true,\"token-limit\":1000,\"temp-dir\":\"/tmp/tidb\",\"tmp-storage-path\":\"/tmp/0_tidb/MC4wLjAuMDo0MDAwLzAuMC4wLjA6MTAwODA=/tmp-storage\",\"tmp-storage-quota\":-1,\"server-version\":\"\",\"version-comment\":\"\",\"tidb-edition\":\"\",\"tidb-release-version\":\"\",\"keyspace-name\":\"\",\"log\":{\"level\":\"info\",\"format\":\"text\",\"disable-timestamp\":null,\"enable-timestamp\":null,\"disable-error-stack\":null,\"enable-error-stack\":null,\"file\":{\"filename\":\"\",\"max-size\":300,\"max-days\":0,\"max-backups\":3},\"slow-query-file\":\"/var/log/tidb/slowlog\",\"expensive-threshold\":10000,\"query-log-max-len\":4096,\"enable-slow-log\":true,\"slow-threshold\":0,\"record-plan-in-slow-log\":1,\"timeout\":0},\"instance\":{\"tidb_general_log\":false,\"tidb_pprof_sql_cpu\":false,\"ddl_slow_threshold\":300,\"tidb_expensive_query_time_threshold\":60,\"tidb_expensive_txn_time_threshold\":600,\"tidb_stmt_summary_enable_persistent\":false,\"tidb_stmt_summary_filename\":\"tidb-statements.log\",\"tidb_stmt_summary_file_max_days\":3,\"tidb_stmt_summary_file_max_size\":64,\"tidb_stmt_summary_file_max_backups\":0,\"tidb_enable_slow_log\":true,\"tidb_slow_log_threshold\":0,\"tidb_record_plan_in_slow_log\":1,\"tidb_check_mb4_value_in_utf8\":true,\"tidb_force_priority\":\"NO_PRIORITY\",\"tidb_memory_usage_alarm_ratio\":0.8,\"tidb_enable_collect_execution_info\":true,\"plugin_dir\":\"/data/deploy/plugin\",\"plugin_load\":\"\",\"max_connections\":0,\"tidb_enable_ddl\":true,\"tidb_rc_read_check_ts\":false,\"tidb_service_scope\":\"\"},\"security\":{\"skip-grant-table\":false,\"ssl-ca\":\"/var/lib/tidb-server-tls/ca.crt\",\"ssl-cert\":\"/var/lib/tidb-server-tls/tls.crt\",\"ssl-key\":\"/var/lib/tidb-server-tls/tls.key\",\"cluster-ssl-ca\":\"\",\"cluster-ssl-cert\":\"\",\"cluster-ssl-key\":\"\",\"cluster-verify-cn\":null,\"session-token-signing-cert\":\"\",\"session-token-signing-key\":\"\",\"spilled-file-encryption-method\":\"plaintext\",\"enable-sem\":false,\"auto-tls\":false,\"tls-version\":\"\",\"rsa-key-size\":4096,\"secure-bootstrap\":false,\"auth-token-jwks\":\"\",\"auth-token-refresh-interval\":\"1h0m0s\",\"disconnect-on-expired-password\":true},\"status\":{\"status-host\":\"0.0.0.0\",\"metrics-addr\":\"\",\"status-port\":10080,\"metrics-interval\":15,\"report-status\":true,\"record-db-qps\":false,\"record-db-label\":false,\"grpc-keepalive-time\":10,\"grpc-keepalive-timeout\":3,\"grpc-concurrent-streams\":1024,\"grpc-initial-window-size\":2097152,\"grpc-max-send-msg-size\":2147483647},\"performance\":{\"max-procs\":0,\"max-memory\":0,\"server-memory-quota\":0,\"stats-lease\":\"3s\",\"stmt-count-limit\":5000,\"pseudo-estimate-ratio\":0.8,\"bind-info-lease\":\"3s\",\"txn-entry-size-limit\":6291456,\"txn-total-size-limit\":104857600,\"tcp-keep-alive\":true,\"tcp-no-delay\":true,\"cross-join\":true,\"distinct-agg-push-down\":false,\"projection-push-down\":false,\"max-txn-ttl\":3600000,\"index-usage-sync-lease\":\"0s\",\"plan-replayer-gc-lease\":\"10m\",\"gogc\":100,\"enforce-mpp\":false,\"stats-load-concurrency\":5,\"stats-load-queue-size\":1000,\"analyze-partition-concurrency-quota\":16,\"plan-replayer-dump-worker-concurrency\":1,\"enable-stats-cache-mem-quota\":true,\"committer-concurrency\":128,\"run-auto-analyze\":true,\"force-priority\":\"NO_PRIORITY\",\"memory-usage-alarm-ratio\":0.8,\"enable-load-fmsketch\":false,\"lite-init-stats\":true,\"force-init-stats\":true},\"prepared-plan-cache\":{\"enabled\":true,\"capacity\":100,\"memory-guard-ratio\":0.1},\"opentracing\":{\"enable\":false,\"rpc-metrics\":false,\"sampler\":{\"type\":\"const\",\"param\":1,\"sampling-server-url\":\"\",\"max-operations\":0,\"sampling-refresh-interval\":0},\"reporter\":{\"queue-size\":0,\"buffer-flush-interval\":0,\"log-spans\":false,\"local-agent-host-port\":\"\"}},\"proxy-protocol\":{\"networks\":\"\",\"header-timeout\":5,\"fallbackable\":false},\"pd-client\":{\"pd-server-timeout\":3},\"tikv-client\":{\"grpc-connection-count\":4,\"grpc-keepalive-time\":10,\"grpc-keepalive-timeout\":3,\"grpc-compression-type\":\"none\",\"commit-timeout\":\"41s\",\"async-commit\":{\"keys-limit\":256,\"total-key-size-limit\":4096,\"safe-window\":2000000000,\"allowed-clock-drift\":500000000},\"max-batch-size\":128,\"overload-threshold\":200,\"max-batch-wait-time\":0,\"batch-wait-size\":8,\"enable-chunk-rpc\":true,\"region-cache-ttl\":600,\"store-limit\":0,\"store-liveness-timeout\":\"1s\",\"copr-cache\":{\"capacity-mb\":1000},\"copr-req-timeout\":60000000000,\"ttl-refreshed-txn-size\":33554432,\"resolve-lock-lite-threshold\":16},\"binlog\":{\"enable\":false,\"ignore-error\":false,\"write-timeout\":\"15s\",\"binlog-socket\":\"\",\"strategy\":\"range\"},\"compatible-kill-query\":false,\"pessimistic-txn\":{\"max-retry-count\":256,\"deadlock-history-capacity\":10,\"deadlock-history-collect-retryable\":false,\"pessimistic-auto-commit\":false,\"constraint-check-in-place-pessimistic\":true},\"max-index-length\":3072,\"index-limit\":64,\"table-column-count-limit\":1017,\"graceful-wait-before-shutdown\":0,\"alter-primary-key\":false,\"treat-old-version-utf8-as-utf8mb4\":true,\"enable-table-lock\":false,\"delay-clean-table-lock\":0,\"split-region-max-num\":1000,\"top-sql\":{\"receiver-address\":\"\"},\"repair-mode\":false,\"repair-table-list\":[],\"isolation-read\":{\"engines\":[\"tikv\",\"tiflash\",\"tidb\"]},\"new_collations_enabled_on_first_bootstrap\":true,\"experimental\":{\"allow-expression-index\":false},\"skip-register-to-dashboard\":false,\"enable-telemetry\":false,\"labels\":{},\"enable-global-index\":false,\"deprecate-integer-display-length\":false,\"enable-enum-length-limit\":true,\"stores-refresh-interval\":60,\"enable-tcp4-only\":false,\"enable-forwarding\":false,\"max-ballast-object-size\":0,\"ballast-object-size\":0,\"transaction-summary\":{\"transaction-summary-capacity\":500,\"transaction-id-digest-min-duration\":2147483647},\"enable-global-kill\":true,\"enable-32bits-connection-id\":true,\"initialize-sql-file\":\"\",\"enable-batch-dml\":false,\"mem-quota-query\":1073741824,\"oom-action\":\"cancel\",\"oom-use-tmp-storage\":true,\"check-mb4-value-in-utf8\":true,\"enable-collect-execution-info\":true,\"plugin\":{\"dir\":\"/data/deploy/plugin\",\"load\":\"\"},\"max-server-connections\":0,\"run-ddl\":true,\"disaggregated-tiflash\":false,\"autoscaler-type\":\"aws\",\"autoscaler-addr\":\"tiflash-autoscale-lb.tiflash-autoscale.svc.cluster.local:8081\",\"is-tiflashcompute-fixed-pool\":false,\"autoscaler-cluster-id\":\"\",\"use-autoscaler\":false,\"tidb-max-reuse-chunk\":64,\"tidb-max-reuse-column\":256,\"tidb-enable-exit-check\":false,\"in-mem-slow-query-topn-num\":30,\"in-mem-slow-query-recent-num\":500}"]
```

### MySQL Client Connect to TiDB Cluster with TLS
1. Save CA/Client Certificate/Private Key
```
kubectl get secret -n tidb-cluster advanced-test-tidb-client-secret  -ojsonpath='{.data.tls\.crt}' | base64 --decode > client-tls.crt
kubectl get secret -n tidb-cluster advanced-test-tidb-client-secret  -ojsonpath='{.data.tls\.key}' | base64 --decode > client-tls.key
kubectl get secret -n tidb-cluster advanced-test-tidb-client-secret  -ojsonpath='{.data.ca\.crt}'  | base64 --decode > client-ca.crt
```

2. Connect with MySQL Client
```
mysql --comments -uroot -p -P 4000 -h ${tidb_host} --ssl-cert=client-tls.crt --ssl-key=client-tls.key --ssl-ca=client-ca.crt
``` 
```sql
mysql> SHOW STATUS LIKE "Ssl%";
+-----------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Variable_name         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
+-----------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
| Ssl_cipher            | TLS_AES_128_GCM_SHA256                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Ssl_cipher_list       | RC4-SHA:DES-CBC3-SHA:AES128-SHA:AES256-SHA:AES128-SHA256:AES128-GCM-SHA256:AES256-GCM-SHA384:ECDHE-ECDSA-RC4-SHA:ECDHE-ECDSA-AES128-SHA:ECDHE-ECDSA-AES256-SHA:ECDHE-RSA-RC4-SHA:ECDHE-RSA-DES-CBC3-SHA:ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:ECDHE-ECDSA-AES128-SHA256:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-CHACHA20-POLY1305:TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256: |
| Ssl_server_not_after  | Jun  6 02:22:01 2025 UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Ssl_server_not_before | Jun  6 02:22:01 2024 UTC                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Ssl_verify_mode       | 5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Ssl_version           | TLSv1.3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
+-----------------------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------+
6 rows in set (0.10 sec)
```
