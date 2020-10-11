const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {
  const CookieString = "xxx=yyy";
  const FolderURL = "you own folder page url";
  const LoadTimeout = 15 * 1000;
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
        console.log(pair);
        return page.setCookie(pair);
      })
    );
  };
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
  let detailPage = await browser.newPage();
  await detailPage.setViewport({ width: 1920, height: 1080 });
  await addCookies(CookieString, detailPage, "blog.sina.com.cn");
  if (!fs.existsSync("data")) {
    fs.mkdirSync("data");
  }
  if (!fs.existsSync("data/images")) {
    fs.mkdirSync("data/images");
  }
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
  const total = links.length;
  while (links && links.length > 0) {
    const index = total - links.length + 1;
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
    let blogClass = "";
    const ClassSelector =
      "#sina_keyword_ad_area > table > tbody > tr > td.blog_class > a";
    try {
      blogClass = await detailPage.$eval(ClassSelector, (ele) => ele.innerHTML);
      console.log(blogClass);
    } catch {
      console.log("Can't find class");
    }
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
        eles.map((ele, index) => {
          return {
            src: ele.getAttribute("src"),
            real_src: ele.getAttribute("real_src"),
            index: index,
          };
        })
      );
    } catch {
      console.log("Can't find images");
    }
    const downloadImg = async (img) => {
      await autoScroll(detailPage);
      const imgResp = await detailPage.waitForResponse(img.real_src, {
        timeout: LoadTimeout,
      });
      const buffer = await imgResp.buffer();
      const imgBase64 = buffer.toString("base64");
      fs.writeFileSync(
        `data/images/${index}_${img.index}.jpg`,
        imgBase64,
        "base64"
      );
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
          await downloadImg(img);
        } catch {
          //retry
          let retryCount = 0;
          let succeed = false;
          while (retryCount < ImageMaxRetry) {
            try {
              console.log("retry download:" + img.real_src);
              retryCount += 1;
              const newPage = await browser.newPage();
              await detailPage.close();
              detailPage = newPage;
              await detailPage.setViewport({ width: 1920, height: 1080 });
              await detailPage.goto(link.url);
              await addCookies(CookieString, detailPage, "blog.sina.com.cn");
              sleep(3000);
              await downloadImg(img);
              succeed = true;
            } catch {
              console.log(
                `retry download failed:${img.real_src} count:${retryCount}`
              );
            }
          }
          if (!succeed) {
            console.log(
              `failed to load the image, maybe sina has lost it:${
                img.real_src
              } on page ${detailPage.url()}`
            );
            browser.close();
            return;
          }
        }
      }
    }
    for (img of images) {
      content = content.replace(img.src, `images/${index}_${img.index}.jpg`);
    }
    const jsonData = JSON.stringify({
      content: content,
      date: date,
      title: link.title,
      url: link.url,
      class: blogClass,
      tags: tags,
    });
    fs.writeFile(`data/${index}.json`, jsonData, (err) => {
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
