using YoutubeMeta.Api.Domain.Rules;
using YoutubeMeta.Api.Infrastructure.Repositories;

namespace YoutubeMeta.Api.Application.Services;

/// <summary>
/// Panel principal (Inicio): cifras, lo urgente de la bandeja, agenda y actividad de la semana en una sola llamada.
/// La salud del sistema la pide el front aparte (ya la consulta cada minuto para la cabecera).
/// </summary>
public sealed class HomeService(InboxRepository inbox, ExceptionHelper exception)
{
    private const int UrgentCount = 5;

    public Task<CustomTransactionResponse<HomeSummary>> Summary(HomeQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchWrapperAsync<CustomTransactionResponse<HomeSummary>>(async () =>
        {
            DateTime dayStart = query.DayStart?.ToUniversalTime() ?? TimeClock.UtcNow.Date;
            DateTime dayEnd = query.DayEnd?.ToUniversalTime() is { } end && end > dayStart && end - dayStart <= TimeSpan.FromHours(26) ? end : dayStart.AddDays(1);

            var (kpis, agenda, activity) = await inbox.Home(dayStart, dayEnd, cancellationToken);
            var awaiting = await inbox.Conversations(new InboxConversationQuery { Awaiting = true, Take = 30 }, cancellationToken);
            foreach (var item in awaiting) InboxRules.WithWindow(item);

            return CustomTransactionResponse<HomeSummary>.Ok(new HomeSummary
            {
                Kpis = kpis,
                // Primero las que cierran antes su ventana de 24 h; después, las que más esperan.
                Urgent = awaiting
                    .OrderBy(c => c.WindowExpiresAt is { } at && at > TimeClock.UtcNow ? at : DateTime.MaxValue)
                    .ThenBy(c => c.AwaitingSince)
                    .Take(UrgentCount)
                    .ToList(),
                Agenda = agenda,
                Activity = activity
            });
        });
}
