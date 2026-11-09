# OpenLifter · GR Cup fork (__HOST__). Installed by deploy/desplegar.sh (__ENTORNO__).
# Static app from __ROOT__; /api goes to the GR Cup gateway on the same origin, so the platform's refresh cookie
# (SameSite=Strict, path /api/auth) works and there is no CORS.

server {
    __LISTEN80__
    server_name __HOST__;
    __ALLOW__
    return 301 https://$host$request_uri;
}

server {
    __LISTEN443__
    http2 on;
    server_name __HOST__;
    ssl_certificate /etc/letsencrypt/live/__HOST__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__HOST__/privkey.pem;
    __ALLOW__
    root __ROOT__;
    index index.html;
    client_max_body_size 4m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "same-origin" always;

    location /api/ {
        proxy_pass http://__UPSTREAM__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
    # Hashed bundles: cached for a year. index.html: always revalidated (a new release is picked up on reload).
    location /static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }
    location / {
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        try_files $uri /index.html;
    }
}
