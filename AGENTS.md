# 给 Agent 的规则

## 自测不能给用户打电话

本机正在运行的 server（`localhost:8787`）和 daemon（`127.0.0.1:8790`）是用户本人在用的环境：发给它们的每一条汇报都会马上变成用户手机上的一通来电。Agent 任务还没结束时发的测试汇报，会让用户先接到一通“假电话”，等任务真正结束后再接一通（YOUT-201）。

- 不要为了看来电界面向运行中的 daemon `POST /report`，或向运行中的 server 发 `/v1/events`、`/v1/daemon/events`、`/v1/daemon/multica-reports`。
- 验证来电界面用单元测试、mock 数据，或一套换端口、换数据库的隔离 server（App 连它，而不是用户正在用的那套）。
- 需要用户亲自接电话验收时，在 Multica 评论里写清楚怎么触发，由用户自己触发。
