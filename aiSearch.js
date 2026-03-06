const fs = require("fs")

function searchProperty(query){

const db = JSON.parse(fs.readFileSync("./db.json"))

const results = db.properties.filter(p=>{

const text = (p.title+" "+p.address+" "+p.price).toLowerCase()

return text.includes(query.toLowerCase())

})

return results.slice(0,3)

}

module.exports = { searchProperty }
