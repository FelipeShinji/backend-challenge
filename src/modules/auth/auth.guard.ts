import { Injectable, CanActivate, ExecutionContext } from "@nestjs/common";
import { Observable } from "rxjs";

/**
 * Ponto de extensão para autenticação do provedor (Section 2 do desafio).
 * Neste desafio, as credenciais e identidade do provedor podem ser passadas
 * via cabeçalho (ex.: X-Provider-Id) ou injetadas mockadamente.
 * Em produção, este Guard integraria com um Identity Provider (Keycloak / Zitadel)
 * validando um JWT assinado.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Ponto de extensão de no-op. Extrai o ID do provedor a partir do header
    // ou usa um valor padrão. Trata o canal como pré-autenticado.
    const providerId = request.headers["x-provider-id"] || "provider-default";
    request.provider = { id: providerId };
    
    return true;
  }
}
