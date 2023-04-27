import Express from 'express';
import escapeStringRegexp from 'escape-string-regexp';
import GeoIP from 'geoip-lite';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';

const NO_GEO_CHECK = false;

const WHITELISTED_COUNTRIES = [
    "eg", // EGYPT : Some cloudflare ips are banned
    "it" // ITALY : for testing of GeoIP
];

const JME_WEBSITES = [
    "hub.jmonkeyengine.org",
    "start.jmonkeyengine.org",
    "donate.jmonkeyengine.org",
    "store.jmonkeyengine.org",
    "library.jmonkeyengine.org",
    "jmonkeyengine.org",
    "wiki.jmonkeyengine.org",
    "javadoc.jmonkeyengine.org"
];

const REWRITE_CONTENT_TYPES = [
    "text/html",
    "text/css",
    "application/javascript",
    "application/json",
    "application/xml",
    "text/javascript",
    "text/json",
    "text/xml"
];

const IP_GEO_CACHE = [];

// check if ip is from whitelisted country
function checkGeoIP(req, countryTag) {
    if (NO_GEO_CHECK) return;
    const ip = req.ip;
    let geo=IP_GEO_CACHE.find((x) => x.ip == ip);
    if(!geo){
        geo={};
        geo.ip=ip;
        geo.country=GeoIP.lookup(ip).country.toLowerCase();
        IP_GEO_CACHE.push(geo);
        if(IP_GEO_CACHE.length>1024){
            IP_GEO_CACHE.shift();
        }           
    }
    if (geo.country!= countryTag.toLowerCase()) {
        throw new Error('Country IP mismatch');
    }
}

// get countryTag and realHost from host
const getRealHost = (host) => {
    host = host.split(':')[0]; // remove port
    const parts = host.split('.').reverse();
    const tld=parts[0];
    const domain=parts[1];
    const countryTag=parts[2];
    const everythingElse=parts.length>3?parts.slice(3).reverse().join('.'):'';
    let realHost=domain+'.'+tld;    
    if(everythingElse){
        realHost=everythingElse+'.'+realHost;
    }
    if (!countryTag) throw new Error('invalid host ' + host);
    if (!realHost) throw new Error('invalid host ' + host);
    return [countryTag.toLowerCase(), realHost];
}

const getCountryHost=(realHost, countryTag)=>{
    const parts = realHost.split('.').reverse();
    const tld=parts[0];
    const domain=parts[1];
    const everythingElse=(parts.length>2?parts.slice(2).reverse().join('.'):'').toLowerCase();
    let host="";
    if(everythingElse){        
        if(everythingElse.endsWith('.'+countryTag)||everythingElse==countryTag){
            return realHost;
        }
        host+=everythingElse+"." ;
    }
    host+=countryTag+'.'+domain+'.'+tld
    return host;
}

// router function, check if everything is ok and return the real host
const router = (req) => {
    const [countryTag, host] = getRealHost(req.headers.host)
    if (!WHITELISTED_COUNTRIES.includes(countryTag)) {
        throw new Error('invalid countryTag');
    }
    checkGeoIP(req, countryTag);
    const target= `https://${host}`;
    console.log(`Proxying ${req.headers.host} to ${target}`);
    return target;
};

// Transform the response
const transform = (req, res, proxyRes, body) => {
    const host = req.headers.host;
    const [countryTag, realHost] = getRealHost(host);
    for (const site of JME_WEBSITES) {
        const xv = [
            "http://" + site,
            "https://" + site,
            "//" + site
        ];
        for (const x of xv) {
            const pattern = new RegExp(escapeStringRegexp(x), 'g');
            body = body.replace(pattern, "https://" +getCountryHost(site, countryTag));
            const headerNames = res.getHeaderNames();
            for (const headerName of headerNames) {
                const headerValue = res.getHeader(headerName);
                if (typeof headerValue === 'string') {
                    proxyRes.headers[headerName] = headerValue.replace(pattern, "https://" + getCountryHost(site, countryTag));
                    res.setHeader(headerName, proxyRes.headers[headerName]);
                }
            }
        }
    }

    
    return body;
}

const app = Express();
app.set("trust proxy", true);

const proxy = createProxyMiddleware({
    router: router,
    changeOrigin: true,
    selfHandleResponse: true,
    xfwd: true,
    hostRewrite: true,
    cookieDomainRewrite: router,
    headers: {
        "X-jme-geopass": "1" // fingerprint the request 
    },
    onProxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
        res.setHeader('X-jme-geopass', '1'); // fingerprint the response 
        res.setHeader('X-Robots-Tag', 'noindex'); // prevent indexing of proxy
 
        // Don't transform if not a whitelisted content type
        let contentType = proxyRes.headers['content-type'];
        contentType = contentType ? contentType.split(';')[0] : 'application/octet-stream';
        if (!REWRITE_CONTENT_TYPES.includes(contentType)) return responseBuffer;

        // Transform
        return transform(req, res, proxyRes, responseBuffer.toString('utf8'));        
    })
});

app.use(proxy);
app.listen(8080);