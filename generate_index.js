const fs = require("fs");
const moment = require("moment");
let i = 0;
let html = "";
html += `<html>
    <head>
    <style type="text/css">
    .blue_border {
      border-left: 6px solid #2196F3;
      background-color: #ddffff;
      padding-left: 20px;
    }
    </style>
    </head>
    <body>`;
html += "<h2 id='title'>Blog Index</h2>";
while (fs.existsSync(`data/${i}.json`)) {
  const data = fs.readFileSync(`data/${i}.json`);
  const blog = JSON.parse(data.toString());
  blog.title = blog.title.replace("&nbsp;", " ");
  console.log(blog.title);
  html += `<p class="blue_border">
  ${i + 1}. ${
    moment(blog.date).format("YYYY-MM-DD HH:mm:ss") + " "
  }<a href="${i}.html" target="_blank" rel="noreferrer noopener" >
  ${blog.class ? "[" + blog.class + "]" : ""}
  ${blog.title}</a>
  ${" "}${"Comment:" + blog.comments.length}
  ${blog.tags.join(",")}
  </p>`;
  i++;
}
html += `</body></html>`;
fs.writeFileSync(`data/index.html`, html);
