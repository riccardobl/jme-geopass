# JME geo pass

Simple reverse proxy to circumvent erroneous country bans on JME IPs.

## Usage

```bash
docker stop jme-geopass || true
docker rm jme-geopass || true
docker build -t jme-geopass .

docker run --read-only \
--tmpfs /tmp \
-d \
--name=jme-geopass \
--restart=always \
jme-geopass

docker network connect --alias jme-geopass.docker nginx_gateway_net jme-geopass  
```