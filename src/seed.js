import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./lib/db.js";

const partnerId = "11111111-1111-4111-8111-111111111111";
const created = "2026-10-01T12:00:00.000Z";
const properties = [
  {id:"22222222-2222-4222-8222-222222222221",name:"Casa do Miradouro",type:"house",neighborhood:"Miramar",bedrooms:3,bathrooms:2,capacity:6,area:180,rate:62000,rating:4.92,reviews:48,occupancy:92,amenities:["Wi-Fi","Piscina"]},
  {id:"22222222-2222-4222-8222-222222222222",name:"Residência Baía Azul",type:"apartment",neighborhood:"Ilha de Luanda",bedrooms:2,bathrooms:2,capacity:4,area:110,rate:105000,rating:4.95,reviews:36,occupancy:82,amenities:["Wi-Fi","Ar condicionado"]},
  {id:"22222222-2222-4222-8222-222222222223",name:"Refúgio da Samba",type:"villa",neighborhood:"Samba",bedrooms:4,bathrooms:3,capacity:8,area:240,rate:85000,rating:4.88,reviews:44,occupancy:80,amenities:["Wi-Fi","Jardim"]},
];
const guests = [
  ["33333333-3333-4333-8333-333333333331","João Manuel","+244 923 456 789"],
  ["33333333-3333-4333-8333-333333333332","Ana Martins","+244 923 555 102"],
  ["33333333-3333-4333-8333-333333333333","Paulo António","+244 924 310 810"],
  ["33333333-3333-4333-8333-333333333334","Carla Domingos","+244 933 120 441"],
];
const bookings = [
  ["2026-10-14","2026-10-18",0,0,2,"confirmed","multicaixa_express"],
  ["2026-10-16","2026-10-20",1,1,3,"checked_in","multicaixa_reference"],
  ["2026-10-22","2026-10-25",2,2,4,"pending","multicaixa_express"],
  ["2026-09-02","2026-09-06",3,0,2,"completed","cash"],
  ["2026-10-25","2026-10-28",0,1,2,"confirmed","multicaixa_reference"],
  ["2026-10-06","2026-10-09",1,0,2,"completed","multicaixa_express"],
];

try {
  await db.prepare("INSERT INTO partners(id,name,email,password_hash,language,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
    .run(partnerId,"Marta Costa","marta@sava.ao",bcrypt.hashSync(process.env.DEMO_PASSWORD||"SavaDemo2026!",10),"pt-AO",created);
  await db.prepare("INSERT INTO settings(partner_id,booking_notifications,payment_notifications) VALUES(?,true,true) ON CONFLICT(partner_id) DO NOTHING").run(partnerId);
  for (const p of properties) {
    await db.prepare("INSERT INTO properties(id,partner_id,name,type,province,city,neighborhood,address,bedrooms,bathrooms,guest_capacity,area_square_meters,floor,amenities,description,nightly_rate,status,rating,review_count,occupancy_rate,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(p.id,partnerId,p.name,p.type,"Luanda","Luanda",p.neighborhood,"",p.bedrooms,p.bathrooms,p.capacity,p.area,null,JSON.stringify(p.amenities),`${p.name}, comfortable accommodation in Luanda.`,p.rate,"published",p.rating,p.reviews,p.occupancy,created,created);
  }
  for (const [id,name,contact] of guests) {
    await db.prepare("INSERT INTO guests(id,partner_id,name,contact,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING").run(id,partnerId,name,contact,created);
  }
  for (const [i,b] of bookings.entries()) {
    const [checkIn,checkOut,guestIndex,propertyIndex,count,status,method]=b;
    const property=properties[propertyIndex], nights=(Date.parse(checkOut)-Date.parse(checkIn))/86400000;
    const id=`44444444-4444-4444-8444-${String(i+1).padStart(12,"0")}`;
    const reference=`RSV-2026-${1042+i}`, amount=nights*property.rate;
    await db.prepare("INSERT INTO reservations(id,reference,partner_id,property_id,guest_id,check_in,check_out,guest_count,night_count,nightly_rate,total_amount,payment_method,invoice_requested,channel,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(id,reference,partnerId,property.id,guests[guestIndex][0],checkIn,checkOut,count,nights,property.rate,amount,method,false,"in_person",status,created,created);
    await db.prepare("INSERT INTO payments(id,reference,reservation_id,partner_id,date,amount,method,status,is_demo) VALUES(?,?,?,?,?,?,?,?,true) ON CONFLICT(id) DO NOTHING")
      .run(`55555555-5555-4555-8555-${String(i+1).padStart(12,"0")}`,`PAY-2026-${1042+i}`,id,partnerId,created,amount,method,["paid","processing","pending","paid","processing","paid"][i]);
  }
  console.log(`Seed data ready. Demo login: marta@sava.ao / ${process.env.DEMO_PASSWORD||"SavaDemo2026!"}`);
} finally {
  await db.close();
}
