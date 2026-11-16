using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Serilog;
using YoutubeMeta.Api;
using YoutubeMeta.Api.Common.Security;
using YoutubeMeta.Api.Infrastructure.RealTime;

// Utilidad para el primer arranque: dotnet run -- --hash-password <clave>
if (args is ["--hash-password", var password])
{
    Console.WriteLine(PasswordHasher.Hash(password));
    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, configuration) => configuration.ReadFrom.Configuration(context.Configuration));
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = DependencyInjection.MaxRequestBodyBytes);

builder.Services.AddYoutubeMeta(builder.Configuration);

var app = builder.Build();
var appSettings = app.Configuration.GetSection("App").Get<AppSettings>() ?? new AppSettings();

// Detrás de un proxy (IIS ARR, nginx…): IP real del cliente y esquema https para los Location de TUS.
app.UseForwardedHeaders();

// Último recurso: cualquier excepción no controlada sale como JSON con un código, nunca con detalles internos.
app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    string code = ExceptionHelper.CorrelationId();
    if (error != null) app.Logger.LogError(error, "Error no controlado [{Code}] en {Path}.", code, context.Request.Path);

    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new CustomGenericResponse<object> { IsSuccess = false, Message = ExceptionHelper.GenericMessage(code) });
}));

if (appSettings.ForceHttps)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}

// El Angular compilado vive en wwwroot: un solo sitio de IIS sirve front, API y SignalR.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// Para monitorizar (IIS, Uptime Kuma…): solo el estado, sin datos. El detalle está en /api/System/Health.
app.MapHealthChecks("/health", new HealthCheckOptions
{
    ResponseWriter = (context, report) => context.Response.WriteAsJsonAsync(new { status = report.Status.ToString() })
});
app.MapControllers();
app.MapHub<ProgressHub>(DependencyInjection.HubPath);
app.MapFallbackToFile("index.html");

app.Run();
