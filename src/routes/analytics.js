import { z } from "zod";
import { db, API, fail, date, authenticate } from "../lib/shared.js";

async function summary(partnerId, from, to) {
  const rs = await db.prepare("SELECT * FROM reservations WHERE partner_id=? AND check_in>=? AND check_in<=? AND status!='cancelled'").all(partnerId, from, to);
  const props = await db.prepare("SELECT * FROM properties WHERE partner_id=?").all(partnerId);
  const rev = rs.filter(r => ["completed","checked_in"].includes(r.status)).reduce((a,r)=>a+Number(r.total_amount),0);
  const luandaToday = new Date().toLocaleDateString("en-CA",{timeZone:"Africa/Luanda"});
  return {
    period:{from,to},revenue:{amount:rev,currency:"AOA",changePercent:0},
    occupancyRate:props.length?Number((props.reduce((a,p)=>a+Number(p.occupancy_rate),0)/props.length).toFixed(1)):0,
    reservationCount:rs.length,averageRating:props.length?Number((props.reduce((a,p)=>a+Number(p.rating),0)/props.length).toFixed(2)):0,
    reviewCount:props.reduce((a,p)=>a+p.review_count,0),
    reservationCounts:{total:rs.length,completed:rs.filter(r=>r.status==="completed").length,upcoming:rs.filter(r=>r.check_in>=luandaToday).length,pending:rs.filter(r=>r.status==="pending").length},
  };
}

export default function register(app) {
  const periodQ=z.object({from:date.optional(),to:date.optional()});
  app.get(API+"/dashboard/summary",authenticate,async(req,res)=>{
    const q=periodQ.safeParse(req.query);if(!q.success)return fail(res,400,"VALIDATION_ERROR","Invalid date range");
    const from=q.data.from||new Date().toLocaleDateString("en-CA",{timeZone:"Africa/Luanda"}),to=q.data.to||from;
    if(to<from)return fail(res,400,"INVALID_DATES","to must be on or after from");
    res.json(await summary(req.partnerId,from,to));
  });
  app.get(API+"/analytics/summary",authenticate,async(req,res)=>{
    const q=periodQ.safeParse(req.query);if(!q.success)return fail(res,400,"VALIDATION_ERROR","Invalid date range");
    const from=q.data.from||"0001-01-01",to=q.data.to||"9999-12-31";
    if(to<from)return fail(res,400,"INVALID_DATES","to must be on or after from");
    const s=await summary(req.partnerId,from,to);
    const statuses=await db.prepare("SELECT status,count(*)::int count FROM reservations WHERE partner_id=? AND check_in>=? AND check_in<=? GROUP BY status").all(req.partnerId,from,to);
    const props=await db.prepare("SELECT id,name,neighborhood,city,status,rating,review_count,occupancy_rate FROM properties WHERE partner_id=?").all(req.partnerId);
    const performance=await Promise.all(props.map(async p=>({propertyId:p.id,name:p.name,location:`${p.neighborhood}, ${p.city}`,status:p.status,rating:Number(p.rating),reviewCount:p.review_count,occupancyRate:Number(p.occupancy_rate),reservationCount:(await db.prepare("SELECT count(*) n FROM reservations WHERE property_id=? AND status!='cancelled'").get(p.id)).n,revenue:Number((await db.prepare("SELECT coalesce(sum(total_amount),0) amount FROM reservations WHERE property_id=? AND status IN ('completed','checked_in') AND check_in>=? AND check_in<=?").get(p.id,from,to)).amount)})));
    res.json({period:s.period,revenue:{total:s.revenue.amount,changePercent:0,currency:"AOA"},occupancyRate:s.occupancyRate,reservationCount:s.reservationCount,averageRating:s.averageRating,revenueByMonth:[{month:from.slice(0,7),amount:s.revenue.amount}],reservationsByStatus:statuses,propertyPerformance:performance});
  });
}
