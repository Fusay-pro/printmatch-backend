// PM2 process config — run: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'printmatch',
      script: 'src/server.js',

      // Cluster mode — one worker per CPU core (good for ALB multi-instance demo)
      instances: 'max',
      exec_mode: 'cluster',

      // Auto-restart if memory > 400 MB
      max_memory_restart: '400M',

      // Keep logs
      out_file: '/home/ec2-user/logs/printmatch-out.log',
      error_file: '/home/ec2-user/logs/printmatch-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
