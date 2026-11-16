namespace YoutubeMeta.Api.Common;

/// <summary>La BD guarda todo en UTC. La cuota de YouTube se reinicia a medianoche del Pacífico.</summary>
public static class TimeClock
{
    private static readonly TimeZoneInfo Pacific = TimeZoneInfo.FindSystemTimeZoneById("America/Los_Angeles");

    public static DateTime UtcNow => DateTime.UtcNow;

    public static DateTime PacificToday => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Pacific).Date;

    /// <summary>Medianoche PT siguiente (+5 min de margen), en UTC.</summary>
    public static DateTime NextPacificMidnightUtc()
    {
        DateTime next = PacificToday.AddDays(1).AddMinutes(5);
        return TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(next, DateTimeKind.Unspecified), Pacific);
    }
}
