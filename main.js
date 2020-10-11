const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  const addCookies = async (cookies_str, page, domain) => {
    let cookies = cookies_str.split(";").map((pair) => {
      let name = pair.trim().slice(0, pair.trim().indexOf("="));
      let value = pair.trim().slice(pair.trim().indexOf("=") + 1);
      return { name, value, domain };
    });
    await Promise.all(
      cookies.map((pair) => {
        console.log(pair);
        return page.setCookie(pair);
      })
    );
  };
  const CookieString =
    "";
  const FolderURL = "";
  const browser = await puppeteer.launch({ headless: false });
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
  const detailPage = await browser.newPage();
  await addCookies(CookieString, detailPage, "blog.sina.com.cn");
  if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
  }
  const total = links.length;
  while (links && links.length > 0) {
    const index = total - links.length + 1;
    link = links.pop();
    console.log("Fetching detail page:" + link.title);
    await detailPage.goto(link.url);
    const ContentSelector = "#sina_keyword_ad_area2";
    await detailPage.waitForSelector(ContentSelector);
    const content = await detailPage.$eval(
      ContentSelector,
      (ele) => ele.innerHTML
    );
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
    } catch {
      console.log("Can't find tags");
    }
    console.log(tags);
    let blogClass = "";
    const ClassSelector =
      "#sina_keyword_ad_area > table > tbody > tr > td.blog_class > a";
    try {
      blogClass = await detailPage.$eval(ClassSelector, (ele) => ele.innerHTML);
    } catch {
      console.log("Can't find class");
    }
    console.log(blogClass);
    const jsonData = JSON.stringify({
      content: content,
      date: date,
      title: link.title,
      url: link.url,
      class: blogClass,
      tags: tags,
    });
    fs.writeFile("data/" + index + ".json", jsonData, (err) => {
      if (err) {
        console.error(err);
      }
    });
    let html = "";
    html += "<h2 id='title'>" + link.title + "</h2>";
    html += "<p id='url'>原地址：" + link.url + "</p>";
    html += "<p id='date'>发布时间：" + date + "</p>";
    html += "<p id='class'>分类：" + blogClass + "</p>";
    html += "<p id='tags'>标签：" + tags.join(",") + "</p>";
    html += "<div id='content'>" + content + "</div>";
    fs.writeFile("data/" + index + ".html", html, (err) => {
      if (err) {
        console.error(err);
      }
    });
    finishedLinks.push(link);
  }
  browser.close();
})();
