# LingoLife Demo deployment

Target: Ubuntu 24.04, x86_64, 1 GB RAM, Nginx, systemd, and
`lingolife.api.shimooth.me`.

The API runs as the unprivileged `lingolife` service account on
`127.0.0.1:8010`. One Uvicorn worker is deliberate for this small VPS. Nginx is
the only public application entry point. The host currently has another service
on public port 8000, so do not bind LingoLife there.

## Secret handling

Never commit or copy a key into a command line. Create
`/etc/lingolife/lingolife.env` in an interactive root session, using
`config/server.env.example` as the list of variables. It must be owned by root,
group `lingolife`, mode `0640`. The DeepSeek key remains in that file and is
read by systemd; it is never sent to Unity or printed by these scripts.

## First deployment

The following commands change the VPS and must only be run after reviewing the
templates and checking that the existing Nginx configuration has no matching
`server_name`:

1. As root, run `deploy/scripts/install-host.sh` from a reviewed copy of the repository.
2. Copy a clean checkout into `/opt/lingolife/app`, owned by
   `lingolife-deploy:lingolife-deploy`. An archive copied over SSH is preferred;
   do not copy a personal GitHub key to the VPS.
3. Create `/etc/lingolife/lingolife.env` without displaying its values. Use:

   ```dotenv
   DEEPSEEK_API_KEY=...
   DATABASE_URL=sqlite:////opt/lingolife/data/lingolife.db
   LOG_LEVEL=INFO
   ```

4. As root, install the reviewed service and Nginx files, then create a narrowly
   scoped sudo rule for future restarts:

   ```bash
   install -o root -g root -m 0644 /opt/lingolife/app/deploy/systemd/lingolife-api.service /etc/systemd/system/lingolife-api.service
   install -o root -g root -m 0644 /opt/lingolife/app/deploy/nginx/lingolife.api.shimooth.me.conf /etc/nginx/sites-available/lingolife.api.shimooth.me.conf
   ln -sfn /etc/nginx/sites-available/lingolife.api.shimooth.me.conf /etc/nginx/sites-enabled/lingolife.api.shimooth.me.conf
   printf '%s\n' 'lingolife-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart lingolife-api.service' > /etc/sudoers.d/lingolife-deploy-lingolife
   chmod 0440 /etc/sudoers.d/lingolife-deploy-lingolife
   visudo -cf /etc/sudoers.d/lingolife-deploy-lingolife
   systemctl daemon-reload
   nginx -t
   systemctl enable lingolife-api.service
   systemctl reload nginx
   ```

5. As `lingolife-deploy`, run `deploy/scripts/deploy-release.sh`.
6. Verify HTTP reaches the correct virtual host:

   ```bash
   curl --resolve lingolife.api.shimooth.me:80:127.0.0.1 \
     http://lingolife.api.shimooth.me/api/v1/health
   ```

7. Issue and install the certificate only after the HTTP check succeeds:

   ```bash
   certbot --nginx -d lingolife.api.shimooth.me
   certbot renew --dry-run
   ```

8. Verify `https://lingolife.api.shimooth.me/api/v1/health`, then restrict TCP
   8000 in the cloud firewall/UFW if the unrelated existing service does not
   require public access. Do not change that existing service without first
   identifying its owner and purpose.

## Updates and rollback

Before an update, copy the SQLite database with SQLite's online backup command
or stop the service briefly and copy the database. Keep the previous Git commit
ID. After updating the clean checkout, rerun `deploy-release.sh` and test the
health endpoint. To roll back, check out the recorded commit, rerun the release
script, and restore the database only if a migration made it incompatible.

Useful diagnostics (they do not expose the environment file):

```bash
systemctl status lingolife-api.service --no-pager
journalctl -u lingolife-api.service -n 100 --no-pager
nginx -t
curl http://127.0.0.1:8010/api/v1/health
```

## Confirmed preflight state (2026-08-17)

- Ubuntu 24.04.4 LTS, x86_64; 961 MiB RAM and 1 GiB swap.
- Git, Python 3, Docker, Nginx, and systemd are installed; Caddy is absent.
- Nginx and UFW are active.
- TCP 22, 80, 443, and 8000 listen publicly. Port 8000 belongs to an existing
  Docker/Uvicorn workload and is not changed by this deployment.
- DNS A record for `lingolife.api.shimooth.me` resolves to `198.46.175.233`, the
  SSH target. No AAAA record was returned.
- SSH alias logs in as `lingolife-deploy`; it has no passwordless sudo. A human
  administrator must perform the root-only installation steps or grant narrowly
  scoped deployment privileges.
