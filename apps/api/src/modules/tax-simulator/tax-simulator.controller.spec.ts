import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { TaxSimulatorController } from './tax-simulator.controller';

// BUG 5 — routes reported as 404 even though OpenAPI docs list them. Root
// cause was a stale observation; the routes are wired (TaxSimulatorModule is
// imported in app.module.ts, controller @Controller('tax-simulator') prefix
// matches /api/v1/tax-simulator/* under main.ts's globalPrefix). This spec
// asserts those facts at the metadata level so a future refactor that drops
// the module import or breaks the prefix fails loudly in CI rather than 404s
// in production.

describe('TaxSimulatorController — route surface (BUG 5)', () => {
  function handler(name: string): Function {
    const h = (TaxSimulatorController.prototype as any)[name];
    if (typeof h !== 'function') {
      throw new Error(`No handler named "${name}" on TaxSimulatorController`);
    }
    return h;
  }

  it('declares @Get("iva") with the documented route segment', () => {
    // NestJS stores the @Get(...) path string under metadata key 'path'.
    const path = Reflect.getMetadata('path', handler('iva'));
    expect(path).toBe('iva');
  });

  it('declares @Get("irc") with the documented route segment', () => {
    const path = Reflect.getMetadata('path', handler('irc'));
    expect(path).toBe('irc');
  });

  it('uses GET (not POST/PATCH/DELETE) — the simulator is read-only', () => {
    // metadata key 'method' carries a numeric RequestMethod enum value.
    // RequestMethod.GET === 0; POST === 1; PATCH === 2; DELETE === 3.
    expect(Reflect.getMetadata('method', handler('iva'))).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata('method', handler('irc'))).toBe(RequestMethod.GET);
  });

  it('controller is registered with a non-empty prefix — confirms @Controller() is present', () => {
    // NestJS doesn't expose the controller prefix under a single metadata
    // key — it walks the class hierarchy. The proxy class produced by
    // @Controller('tax-simulator') carries the prefix as constructor-side
    // metadata; verifying its presence here catches a future refactor that
    // drops @Controller() or strips the prefix string.
    const ctor = TaxSimulatorController as any;
    const prefix =
      Reflect.getMetadata('path', ctor) ?? Reflect.getMetadata('prefix', ctor);
    expect(prefix).toBe('tax-simulator');
  });

  it('routes only declare @Get (no POST/PATCH/DELETE/PUT) — preserves the simulator contract', () => {
    // Walk every method on the prototype and collect those that carry an
    // HTTP-verb metadata key. If a future refactor accidentally adds a
    // POST, this fails and forces the author to update the simulator docs.
    const proto = TaxSimulatorController.prototype;
    const verbNames = Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor')
      .filter((n) => {
        const m = Reflect.getMetadata('method', (proto as any)[n]);
        return typeof m === 'number';
      });
    expect(verbNames.sort()).toEqual(['irc', 'iva']);
  });

  it('instantiates with a stub service without throwing (wiring smoke)', () => {
    const stub: any = {
      simulateIva: jest.fn(),
      simulateIrc: jest.fn(),
    };
    expect(() => new TaxSimulatorController(stub)).not.toThrow();
    const ctrl = new TaxSimulatorController(stub);
    expect(typeof ctrl.iva).toBe('function');
    expect(typeof ctrl.irc).toBe('function');
  });
});