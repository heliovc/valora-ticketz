declare namespace Express {
  export interface Request {
    user: { id: string; profile: string; isSuper: boolean; companyId: number };
    companyId: number | undefined;
    /**
     * Corpo cru da requisição. Populado SÓ nas rotas do webhook da Meta (ver
     * `app.ts`): a assinatura `X-Hub-Signature-256` é calculada sobre os bytes
     * exatos que a Meta enviou, e `JSON.stringify(req.body)` não os reproduz
     * (ordem de chaves, escape de unicode, espaçamento).
     */
    rawBody?: Buffer;
  }
}
