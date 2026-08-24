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
  }],
}
