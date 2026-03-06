
const axios = require("axios")
const cheerio = require("cheerio")

const URLS = [
"https://makler.md/tiraspol/real-estate/real-estate-for-sale/apartments-for-sale/",
"https://makler.md/tiraspol/real-estate/real-estate-for-sale/houses-for-sale/"
]

async function parseMakler(){

const ads=[]

for(const url of URLS){

try{

const {data}=await axios.get(url,{
headers:{ "User-Agent":"Mozilla/5.0"}
})

const $=cheerio.load(data)

$("a[href*='/an/']").each((i,el)=>{

const title=$(el).text().trim()

const href=$(el).attr("href")

if(!href) return

const link="https://makler.md"+href

// фильтр агентств

const low=title.toLowerCase()

if(
low.includes("агентство")||
low.includes("риелтор")||
low.includes("агент")
) return

ads.push({
title,
link
})

})

}catch(e){
console.log("Makler error")
}

}

return ads

}

module.exports = { parseMakler }
