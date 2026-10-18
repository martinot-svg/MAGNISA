import {describe,it,expect} from "vitest";
import {computeHealthContribution} from "./health-contribution";

describe("Cotisations OMIT - plafond configuré à 1 600 000 MGA",()=>{
 const calc=(gross:number)=>computeHealthContribution(gross,1600000,0.01,0.05);
 it("sous le plafond : 500 000",()=>{
  expect(calc(500000)).toEqual({base:500000,employee:5000,employer:25000});
 });
 it("sous le plafond : 1 000 000",()=>{
  expect(calc(1000000)).toEqual({base:1000000,employee:10000,employer:50000});
 });
 it("exactement au plafond",()=>{
  expect(calc(1600000)).toEqual({base:1600000,employee:16000,employer:80000});
 });
 it("au-dessus du plafond : 2 000 000",()=>{
  expect(calc(2000000)).toEqual({base:1600000,employee:16000,employer:80000});
 });
 it("paramètres invalides refusés",()=>{
  expect(()=>computeHealthContribution(500000,0,0.01,0.05)).toThrow();
  expect(()=>computeHealthContribution(-1,1600000,0.01,0.05)).toThrow();
 });
});
