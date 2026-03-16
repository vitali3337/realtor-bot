const makler = require("./makler");
const autopost = require("./autopost");

console.log("⏱ Запущен планировщик объявлений");

async function run() {

try {

    const newObjects = await makler.load();

    if(newObjects.length){

        console.log("Найдено объектов:", newObjects.length);

        for(const obj of newObjects){

            await autopost.publish(obj);

        }

    }

} catch(e){

    console.log("Ошибка:", e.message);

}

}

setInterval(run, 600000);

run();
