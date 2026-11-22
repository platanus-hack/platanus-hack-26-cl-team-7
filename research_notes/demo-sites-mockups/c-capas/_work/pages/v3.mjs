// Respuesta cruda de Vite (text/javascript) tal como la muestra Chrome: sin estilos, fuente por defecto.
const passwd = [
  'root:x:0:0:root:/root:/bin/bash',
  'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
  'bin:x:2:2:bin:/bin:/usr/sbin/nologin',
  'sys:x:3:3:sys:/dev:/usr/sbin/nologin',
  'sync:x:4:65534:sync:/bin:/bin/sync',
  'games:x:5:60:games:/usr/games:/usr/sbin/nologin',
  'man:x:6:12:man:/var/cache/man:/usr/sbin/nologin',
  'lp:x:7:7:lp:/var/spool/lpd:/usr/sbin/nologin',
  'mail:x:8:8:mail:/var/mail:/usr/sbin/nologin',
  'www-data:x:33:33:www-data:/var/www:/usr/sbin/nologin',
  'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
  'node:x:1000:1000::/home/node:/bin/bash',
].join('\n') + '\n';
const js = 'export default ' + JSON.stringify(passwd);
const esc = js.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export default `<html><head><meta charset="utf-8"><title>bruma-rrhh.test:5173/@fs/etc/passwd?import&amp;raw</title></head><body><pre style="word-wrap: break-word; white-space: pre-wrap;">${esc}</pre></body></html>
`;
