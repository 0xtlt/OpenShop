const workerConcurrency = process.env.OPENSHOP_WORKER_CONCURRENCY ?? '5'
const openshopCli = 'node_modules/openshop/bin/cli.js'

module.exports = {
  apps: [
    {
      name: '__PACKAGE_NAME__-web',
      script: openshopCli,
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
    },
    {
      name: '__PACKAGE_NAME__-worker',
      script: openshopCli,
      args: `worker --concurrency=${workerConcurrency}`,
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
    },
  ],
}
