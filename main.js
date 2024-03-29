const puppeteer = require("puppeteer");
const fs = require("fs");
const config = require("./config.js");
const cheerio = require("cheerio");
const axios = require("axios");

var downloadPic = function (src, dest) {
  const picHeaders = {
    timeout: 5000,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "max-age=0",
    Connection: "keep-alive",
    Referer: "http://blog.sina.com.cn/",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
  };
  axios({
    method: "get",
    url: src,
    responseType: "stream",
    headers: picHeaders,
  })
    .then((response) => {
      response.data.pipe(fs.createWriteStream(dest));
    })
    .catch((err) => {
      console.log("下载图片错误:", err);
    });
};

const autoScroll = async (page) => {
  return page.evaluate(() => {
    return new Promise((resolve) => {
      var totalHeight = 0;
      var distance = 100;
      var timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
};

(async () => {
  const { CookieString, FolderURL } = config;
  const LoadTimeout = 15 * 1000;
  const CommentsLoadTimeout = 5 * 1000;
  const ImageMaxRetry = 10;
  function sleep(milliSeconds) {
    var startTime = new Date().getTime();
    while (new Date().getTime() < startTime + milliSeconds);
  }
  const addCookies = async (cookies_str, page, domain) => {
    let cookies = cookies_str.split(";").map((pair) => {
      let name = pair.trim().slice(0, pair.trim().indexOf("="));
      let value = pair.trim().slice(pair.trim().indexOf("=") + 1);
      return { name, value, domain };
    });
    await Promise.all(
      cookies.map((pair) => {
        return page.setCookie(pair);
      })
    );
  };
  const browser = await puppeteer.launch({ headless: true });
  const folderPage = await browser.newPage();
  await folderPage.setViewport({ width: 1920, height: 1080 });
  console.log("Fetching folder page:" + FolderURL);
  await addCookies(CookieString, folderPage, "blog.sina.com.cn");
  await folderPage.goto(FolderURL);
  //Fetch folders
  let links = [];
  let pageNext = "";
  do {
    if (pageNext) {
      await folderPage.goto(pageNext);
    }
    try {
      await folderPage.waitForSelector("div.articleList", {
        timeout: 5000,
      });
      //Some pages may be empty
    } catch (err) {
      console.error(err);
      break;
    }
    const ListSelector =
      "div.SG_connBody > div.article_blk > div.articleList > div > p.atc_main.SG_dot > span.atc_title > a";
    const tempLinks = await folderPage.$$eval(ListSelector, (eles) =>
      eles.map((ele) => {
        return {
          title: ele.innerHTML,
          url: ele.href,
        };
      })
    );
    links = links.concat(tempLinks);
    //Fetch next page
    const BtuNextSelector =
      "div.SG_connBody > div.article_blk > div.SG_page > ul > li.SG_pgnext > a";
    pageNext = await folderPage.$eval(BtuNextSelector, (ele) => ele.href);
    console.log("Next Page:" + pageNext);
  } while (pageNext);
  console.log("Found articles:" + links.length);
  await folderPage.close();
  //Fetch detail page
  const finishedLinks = [];
  let detailPage = await browser.newPage();
  await detailPage.setViewport({ width: 1920, height: 1080 });
  await addCookies(CookieString, detailPage, "blog.sina.com.cn");
  if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
  }
  if (!fs.existsSync("data/images")) {
    fs.mkdirSync("data/images");
  }
  if (!fs.existsSync("data/screenshots")) {
    fs.mkdirSync("data/screenshots");
  }
  const total = links.length;
  while (links && links.length > 0) {
    const index = total - links.length;
    link = links.pop();
    console.log(`Fetching detail page:${index}/${total} - ${link.title}`);
    if (fs.existsSync(`data/${index}.json`) && `data/${index}.html`) {
      console.log(
        `page already downloaded so skip waiting:${index}/${total} - ${link.title}`
      );
      continue;
    }
    await detailPage.goto(link.url);
    const ContentSelector = "#sina_keyword_ad_area2";
    await detailPage.waitForSelector(ContentSelector);
    let content = await detailPage.$eval(
      ContentSelector,
      (ele) => ele.innerHTML
    );
    // autoScroll(detailPage);
    const DateSelector = "#articlebody > div.articalTitle > .time";
    let date = await detailPage.$eval(DateSelector, (ele) => ele.innerHTML);
    date = date.replace("(", "").replace(")", "").replace(":", "-");
    console.log(date);
    const TagSelector =
      "#sina_keyword_ad_area > table > tbody > tr > td.blog_tag > h3";
    let tags = [];
    try {
      tags = await detailPage.$$eval(TagSelector, (eles) =>
        eles.map((ele) => ele.innerHTML)
      );
      console.log(tags);
    } catch {
      console.log("Can't find tags");
    }
    // save comments
    const CommentSelector = "#article_comment_list > li > div:nth-child(2)";
    let findComments = false;
    try {
      await detailPage.waitForSelector(CommentSelector, {
        timeout: CommentsLoadTimeout,
      });
      findComments = true;
    } catch {
      console.log("Timeout, can't find comments");
    }
    let comments = [];
    if (findComments) {
      try {
        comments = await detailPage.$$eval(CommentSelector, (eles) =>
          eles.map((ele) => ele.outerHTML)
        );
        comments = comments.map((html, i) => {
          const $ = cheerio.load(html);
          return {
            title: $("p:nth-child(1)").text(),
            content: $("div.SG_revert_Inner").text(),
            date: $("p.myReFrom > em").text(),
            html: html,
            index: i,
          };
        });
        console.log("comments:");
        console.log(comments);
      } catch (e) {
        console.error(e);
        console.log("Can't eval comments");
      }
    }
    //save class
    let blogClass = "";
    const ClassSelector =
      "#sina_keyword_ad_area > table > tbody > tr > td.blog_class > a";
    try {
      blogClass = await detailPage.$eval(ClassSelector, (ele) => ele.innerHTML);
      console.log(blogClass);
    } catch {
      console.log("Can't find class");
    }
    //save images
    const ImageSelector = "#sina_keyword_ad_area2 img";
    let findImage = false;
    try {
      await detailPage.waitForSelector(ImageSelector, { timeout: LoadTimeout });
      findImage = true;
    } catch {
      console.log("Timeout, can't find the img element");
    }
    let images = [];
    try {
      images = await detailPage.$$eval(ImageSelector, (eles) =>
        eles.map((ele, i) => {
          return {
            src: ele.getAttribute("src"),
            real_src: ele.getAttribute("real_src"),
            index: i,
            originalURL: ele
              .getAttribute("real_src")
              .replace("bmiddle", "orignal"),
          };
        })
      );
    } catch {
      console.log("Can't find images");
    }
    const saveImage = async (img) => {
      console.log("download image success:" + img.originalURL);
      const imagePath = `data/images/${index}_${img.index}.jpg`;
      downloadPic(img.originalURL, imagePath);
    };
    if (findImage) {
      for (img of images) {
        const imgPath = `data/images/${index}_${img.index}.jpg`;
        if (fs.existsSync(imgPath)) {
          console.log("image already exists so skip waiting:" + imgPath);
          continue;
        }
        console.log("downloading image:" + img.real_src);
        try {
          await saveImage(img);
        } catch {
          //retry
          let retryCount = 0;
          let succeed = false;
          while (retryCount < ImageMaxRetry) {
            try {
              console.log("retry download:" + img.real_src);
              retryCount += 1;
              sleep(3000);
              await saveImage(img);
              succeed = true;
            } catch {
              console.log(
                `retry download failed:${img.real_src} count:${retryCount}`
              );
            }
          }
          if (!succeed) {
            console.error(
              `failed to load the image, maybe sina has lost it:${
                img.real_src
              } on page ${detailPage.url()}`
            );
            return;
          }
        }
      }
    }
    //take screenshot
    const screenshotPath = `data/screenshots/${index}.png`;
    try {
      await detailPage.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
    } catch (e) {
      console.error("take screenshot error:");
      console.error(e);
    }
    for (img of images) {
      console.log("replacing output image:" + img.originalURL);
      const $ = cheerio.load(content);
      if ($(`img`).eq(img.index) == null) {
        continue;
      }
      console.log(
        "img:" + img.index + " " + $(`img`).eq(img.index).attr("src")
      );
      newSRC = `images/${index}_${img.index}.jpg`;
      $(`img`).eq(img.index).attr("src", newSRC);
      console.log("replace success:" + newSRC);
      content = $.html();
    }
    const jsonData = JSON.stringify({
      content: content,
      date: date,
      title: link.title,
      url: link.url,
      class: blogClass,
      tags: tags,
      comments: comments,
    });
    fs.writeFile(`data/${index}.json`, jsonData, (err) => {
      if (err) {
        console.error(err);
      }
    });
    let html = "";
    html += `<html>
    <head>
    <style type="text/css">
    .blue_border {
      border-left: 6px solid #2196F3;
      background-color: #ddffff;
      padding-left: 20px;
    }
    .screenshot{
      width: 100%;
      height: auto;
    }
    img{
      max-width: 100%;
    }
    </style>
    </head>
    <body>`;
    html += "<h2 id='title'>" + link.title + "</h2>";
    html +=
      `<p id='url' class='blue_border'>原地址：<a href='${link.url}' target='_blank'>` +
      link.url +
      "</a></p>";
    html += "<p id='date' class='blue_border'>发布时间：" + date + "</p>";
    html += "<p id='class' class='blue_border'>分类：" + blogClass + "</p>";
    html += "<p id='tags' class='blue_border'>标签：" + tags.join(",") + "</p>";
    html += `<p id='url'>
    ${
      index > 0
        ? `<a href='${index - 1}.html'>上一篇</a>`
        : "<span>上一篇</span>"
    }
    <span style="margin-right:20px"></span>
    ${
      index < total - 1
        ? `<a href='${index + 1}.html'>下一篇</a>`
        : "<span>下一篇</span>"
    }</p>`;
    html += "<div id='content'>" + content + "</div>";
    if (comments.length > 0) {
      html +=
        "<p id='tags'>评论：" +
        comments.map((comment) => {
          return `<div class="SG_revert_Cont blue_border">
        <p><span class="SG_revert_Tit">${comment.title}</span></p>
        <div class="SG_revert_Inner SG_txtb">${comment.content}</div>
        <p class="myReFrom">
          <em class="SG_txtc">${comment.date}</em>
        </p>
      </div>`;
        }) +
        "</p>";
    }
    html += "<p class='blue_border'>截图：</p>";
    html += `<img class="screenshot" src="${`screenshots/${index}.png`}" />`;
    html += `</body></html>`;
    fs.writeFile(`data/${index}.html`, html, (err) => {
      if (err) {
        console.error(err);
      }
    });
    //Prevent too frequent
    sleep(5000);
    finishedLinks.push(link);
  }
  browser.close();
})();
