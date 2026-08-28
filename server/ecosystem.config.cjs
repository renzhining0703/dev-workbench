/**
 * pm2 配置（v2）
 * 启动：pm2 start ecosystem.config.cjs
 * 自启：pm2 save && pm2 startup
 *
 * 环境变量由 publish.sh 在远端注入（参见 scripts/publish.sh）
 * 注意：BOOTSTRAP_USER / INVITE_CODE / ALLOWED_ORIGINS 建议通过 pm2 --update-env 注入，
 *       不要写在这里（一旦提交就成了源码的一部分）
 */
module.exports = {
  apps: [{
    name: 'dev-workbench-sync',
    script: './index.mjs',
    node_args: '--no-warnings', // node:sqlite 在 Node 22 是实验性 API，静默其 warning
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork', // 单进程 + SQLite：WAL 支持读写并发，无需 cluster
    autorestart: true,
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: 8787,
      DATA_DIR: __dirname + '/data/',
    },
    max_memory_restart: '128M',
  }, {
    // 每日 03:17 自动备份 SQLite 到 data/backups/，保留最近 7 份
    // autorestart:false —— 跑完即退，pm2 不重启，cron 到点再起一次
    name: 'dev-workbench-backup',
    script: './scripts/backup-db.mjs',
    node_args: '--no-warnings',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: false,
    cron: '17 3 * * *',
    env: {
      DATA_DIR: __dirname + '/data/',
    },
  }, {
    // 每日 09:05 推送「今日待上线/待办」提醒（Web Push）
    // 前置：data/env.local 配置 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
    name: 'dev-workbench-push-daily',
    script: './scripts/push-daily.mjs',
    node_args: '--no-warnings',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    autorestart: false,
    cron: '5 9 * * *',
    env: {
      DATA_DIR: __dirname + '/data/',
    },
  }],
}
