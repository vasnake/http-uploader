var http = require('http');

var server = http.createServer(
	function (request, response) {
		response.writeHead(200, {'Content-Type': 'text/plain'});
		response.end('Hello World\n');
		console.log('Page requested at ' + new Date() + ', for ' + request.url);
	}
);

server.listen(1337, "0.0.0.0");

console.log('Server running at <a href="http://node:1337/">http://node:1337/</a>');
