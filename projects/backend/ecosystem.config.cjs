module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || 'pymeplus-ia-backend',
      script: './index.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '1000M',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'development',
        PORT: process.env.PORT || 3500
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3500
      },
      autorestart: true,
      max_restarts: 10,
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
