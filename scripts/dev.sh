#!/usr/bin/env bash
# 一键启动本地开发环境：MySQL 容器 → outbrief-server(:8787) → OutBrief 桌面端（vite :1520）。
#
#   scripts/dev.sh
#
# 服务端目录默认是同级目录，目录名里的 app 换成 server（outbrief-app → outbrief-server，
# app-p1 → server-p1）；也可以用 OUTBRIEF_SERVER_DIR=<目录> 指定。
# 端口被占用时，先结束占用进程再启动。服务端日志写到 logs/server.log。
# 托盘里点「退出」、按 Ctrl+C 或直接关掉终端，本脚本启动的服务端都会一起停止（关窗口只是收到托盘）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/logs"
SERVER_LOG="$LOG_DIR/server.log"
MYSQL_CONTAINER=some-mysql
# 与 vite.config.ts 的 server.port、tauri.conf.json 的 build.devUrl 保持一致
APP_PORT=1520
STARTUP_TIMEOUT=60

if [ -t 1 ]; then
    C_INFO=$'\033[1;34m' C_OK=$'\033[1;32m' C_WARN=$'\033[1;33m' C_ERR=$'\033[1;31m' C_OFF=$'\033[0m'
else
    C_INFO='' C_OK='' C_WARN='' C_ERR='' C_OFF=''
fi
# 提示语里的变量一律写成 ${var}：macOS 自带的 bash 3.2 在 UTF-8 locale 下，会把紧跟在变量名后面的中文字节
# 也读成变量名，配合 set -u 直接报 unbound variable 退出。
info() { printf '%s[dev]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
ok() { printf '%s[dev]%s %s\n' "$C_OK" "$C_OFF" "$*"; }
warn() { printf '%s[dev]%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die() {
    printf '%s[dev]%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2
    exit 1
}

for arg in "$@"; do
    case "$arg" in
        -h | --help)
            sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) die "未知参数：${arg}" ;;
    esac
done

# ---------- 进程与端口 ----------

SERVER_PGID=""

# 结束本脚本启动的服务端。服务端是一个独立进程组，整组结束（包括 pnpm 拉起的 node）。
stop_server() {
    # 终端关掉后再往终端输出会失败：关掉 errexit、忽略 SIGPIPE，保证后面的 kill 一定执行
    set +e
    trap '' INT TERM HUP PIPE # 清理过程中再按 Ctrl+C 也不打断清理
    [ -n "$SERVER_PGID" ] || return 0
    info "停止 outbrief-server…"
    kill -TERM -- "-$SERVER_PGID" 2>/dev/null || true
    for _ in $(seq 1 20); do
        kill -0 -- "-$SERVER_PGID" 2>/dev/null || break
        sleep 0.5
    done
    kill -KILL -- "-$SERVER_PGID" 2>/dev/null || true
    wait "$SERVER_PGID" 2>/dev/null || true
    SERVER_PGID=""
    ok "outbrief-server 已停止"
}
trap stop_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# 监听该端口的进程 PID，空格分隔
listen_pids() {
    lsof -nP -t -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u | paste -sd' ' - || true
}

wait_port_free() { # <端口> <秒>
    local deadline=$((SECONDS + $2))
    while [ -n "$(listen_pids "$1")" ]; do
        [ "$SECONDS" -lt "$deadline" ] || return 1
        sleep 0.25
    done
}

# 端口被占用时结束占用进程：先 SIGTERM，10 秒内没退出再 SIGKILL。
free_port() {
    local port=$1 pids pid comm
    pids=$(listen_pids "$port")
    [ -n "$pids" ] || return 0
    warn "端口 ${port} 被占用："
    { ps -o pid=,command= -p "${pids// /,}" || true; } | sed 's/^/      /' >&2
    for pid in $pids; do
        comm=$({ ps -o comm= -p "$pid" || true; } | tr '[:upper:]' '[:lower:]')
        case "$comm" in
            # Docker / OrbStack 的端口转发进程：杀掉会把所有容器（包括 MySQL）一起停掉
            *orbstack* | *docker* | *vpnkit*)
                die "端口 ${port} 是 Docker 容器发布的端口，不能直接结束进程。先停掉这个容器再运行。"
                ;;
        esac
    done
    info "结束占用进程（PID：${pids}）…"
    # shellcheck disable=SC2086 # $pids 需要按空格拆开
    kill -TERM $pids || true
    if ! wait_port_free "$port" 10; then
        warn "端口 ${port} 10 秒内没有释放，发送 SIGKILL"
        # shellcheck disable=SC2086
        kill -KILL $pids || true
        wait_port_free "$port" 5 || die "端口 ${port} 仍被占用（PID：$(listen_pids "$port")），请手动处理"
    fi
    ok "端口 ${port} 已释放"
}

# ---------- 前置检查 ----------

for cmd in lsof curl docker pnpm node cargo; do
    command -v "$cmd" >/dev/null 2>&1 || die "找不到命令：${cmd}"
done

SERVER_DIR=${OUTBRIEF_SERVER_DIR:-$(dirname "$ROOT")/$(basename "$ROOT" | sed 's/app/server/')}
grep -qs '"name": "outbrief-server"' "$SERVER_DIR/package.json" ||
    die "找不到 outbrief-server（${SERVER_DIR}）。用 OUTBRIEF_SERVER_DIR=<服务端目录> 指定"
SERVER_DIR=$(cd "$SERVER_DIR" && pwd)
# 服务端不需要 .env；有的话按 node --env-file 的规则读（值里可能有括号等 shell 语法，不能 source），当前环境变量优先，与服务端一致
server_env() { # <键> [默认值]
    node -e 'const f = process.argv[1]; if (require("node:fs").existsSync(f)) process.loadEnvFile(f); process.stdout.write(process.env[process.argv[2]] || process.argv[3] || "")' \
        "$SERVER_DIR/.env" "$1" "${2:-}"
}
SERVER_PORT=$(server_env PORT 8787)

if ! running=$(docker inspect -f '{{.State.Running}}' "$MYSQL_CONTAINER" 2>&1); then
    die "读不到 MySQL 容器 ${MYSQL_CONTAINER} 的状态（Docker / OrbStack 没启动，或容器不存在）：${running}"
fi
if [ "$running" = true ]; then
    ok "MySQL 容器 ${MYSQL_CONTAINER} 运行中"
else
    info "启动 MySQL 容器 ${MYSQL_CONTAINER}…"
    docker start "$MYSQL_CONTAINER" >/dev/null
    deadline=$((SECONDS + 60))
    until docker exec "$MYSQL_CONTAINER" mysqladmin ping -h127.0.0.1 --silent >/dev/null 2>&1; do
        [ "$SECONDS" -lt "$deadline" ] || die "MySQL 60 秒内没有就绪，用 docker logs ${MYSQL_CONTAINER} 查看原因"
        sleep 1
    done
    ok "MySQL 已就绪"
fi

info "同步依赖（pnpm install --frozen-lockfile）…"
(cd "$SERVER_DIR" && pnpm install --frozen-lockfile --reporter=silent)
(cd "$ROOT" && pnpm install --frozen-lockfile --reporter=silent)

# ---------- 服务端 ----------

free_port "$SERVER_PORT"
mkdir -p "$LOG_DIR"

# 开启 job control 后，服务端在独立的进程组里：终端的 Ctrl+C 不会直接发给它，由 stop_server 整组结束。
set -m
(cd "$SERVER_DIR" && exec pnpm start) </dev/null >"$SERVER_LOG" 2>&1 &
SERVER_PGID=$!
set +m

info "等待 outbrief-server 就绪（最多 ${STARTUP_TIMEOUT}s，日志：logs/server.log）…"
start=$SECONDS
until curl -fsS --max-time 3 "http://127.0.0.1:${SERVER_PORT}/healthz" 2>/dev/null | grep -q '"ok":true'; do
    if ! kill -0 "$SERVER_PGID" 2>/dev/null; then
        tail -n 40 "$SERVER_LOG" >&2
        die "outbrief-server 启动失败，进程已退出。完整日志：logs/server.log"
    fi
    if [ $((SECONDS - start)) -ge "$STARTUP_TIMEOUT" ]; then
        tail -n 40 "$SERVER_LOG" >&2
        die "outbrief-server ${STARTUP_TIMEOUT}s 内没有就绪。完整日志：logs/server.log"
    fi
    sleep 1
done
ok "outbrief-server 已就绪（$((SECONDS - start))s）：http://localhost:${SERVER_PORT}（${SERVER_DIR}）"

# 还没有账号的本地服务端会在日志里打印认领码：交给桌面端，第一个账号不用手填（没有登录，也没有共享口令）
CLAIM_CODE=$(sed -n 's/.*Claim code: \([0-9A-Z-]*\).*/\1/p' "$SERVER_LOG" | tail -n 1)
if [ -n "$CLAIM_CODE" ]; then
    info "服务端还没有主人，桌面端会用日志里的认领码创建第一个账号"
fi

# ---------- 桌面端 ----------

# 还开着的桌面端（旧版本、别的 worktree 起的）：两个窗口会各自把每通电话再响一遍；
# 桌面端是单实例，旧的不关，新开的会直接退出（YOUT-226）
stop_running_apps() {
    local pids
    pids=$(pgrep -x outbrief-app | paste -sd' ' - || true)
    [ -n "$pids" ] || return 0
    info "结束正在运行的桌面端（PID：${pids}）…"
    # shellcheck disable=SC2086 # $pids 需要按空格拆开
    kill -TERM $pids || true
    local deadline=$((SECONDS + 10))
    while pgrep -x outbrief-app >/dev/null; do
        if [ "$SECONDS" -ge "$deadline" ]; then
            warn "桌面端 10 秒内没有退出，发送 SIGKILL"
            # shellcheck disable=SC2086
            kill -KILL $pids || true
            break
        fi
        sleep 0.25
    done
    ok "旧的桌面端已关闭"
}

stop_running_apps
free_port "$APP_PORT"
cd "$ROOT"

# 本地设置里还没填大模型时，用本机 outbrief-daemon 的大模型（llm.primary）预填「设置 → 大模型」。
DAEMON_CONFIG="${OUTBRIEF_HOME:-$HOME/.outbrief}/daemon.json"
daemon_llm() { # <字段>：llm.primary 里的 baseUrl / apiKey / model，没有就输出空
    node -e 'const fs = require("node:fs");
let c;
try { const llm = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).llm; c = llm?.primary; } catch {}
const v = c?.[process.argv[2]];
process.stdout.write(typeof v === "string" ? v : "");' "$DAEMON_CONFIG" "$1"
}
LLM_BASE_URL=$(daemon_llm baseUrl)
LLM_API_KEY=$(daemon_llm apiKey)
LLM_MODEL=$(daemon_llm model)
if [ -n "$LLM_BASE_URL" ] && [ -n "$LLM_API_KEY" ] && [ -n "$LLM_MODEL" ]; then
    export VITE_OUTBRIEF_LLM_BASE_URL="$LLM_BASE_URL" VITE_OUTBRIEF_LLM_API_KEY="$LLM_API_KEY" VITE_OUTBRIEF_LLM_MODEL="$LLM_MODEL"
    ok "大模型默认值取自 ${DAEMON_CONFIG}：${LLM_BASE_URL} · ${LLM_MODEL}"
else
    warn "${DAEMON_CONFIG} 里没有完整的 llm.primary（baseUrl / apiKey / model），通话中提问要先在「设置 → 大模型」里填"
fi
unset LLM_BASE_URL LLM_API_KEY LLM_MODEL

info "启动 OutBrief 桌面端（Rust 有改动时要先编译，稍等）。托盘里点「退出」或按 Ctrl+C 停止全部服务"
# 桌面端还没有账号时：本机有 outbrief-daemon 就加入它的账号，否则在这个服务端上创建一个（用上面的认领码）
VITE_OUTBRIEF_SERVER_URL="http://localhost:${SERVER_PORT}" VITE_OUTBRIEF_CLAIM_CODE="$CLAIM_CODE" pnpm tauri dev
