using Microsoft.AspNetCore.Authorization;
using YoutubeMeta.Api.Application.Services;

namespace YoutubeMeta.Api.Controllers;

[Route("api/[controller]")]
[Authorize]
public class ConnectionController(
        ConnectionService connectionService,
        YoutubeAccountService youtubeAccountService,
        MetaAccountService metaAccountService,
        TelegramAccountService telegramAccountService,
        TiktokAccountService tiktokAccountService,
        LinkedinAccountService linkedinAccountService,
        TeamsAccountService teamsAccountService,
        ContentService contentService,
        IOptions<GoogleSettings> googleSettings,
        ExceptionHelper exception
    ) : CustomControllerBase
{
    [HttpGet]
    public Task<IActionResult> Status(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.Status(cancellationToken), ResponseMessage.Found));

    [HttpGet("Usage")]
    public Task<IActionResult> Usage(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.Usage(cancellationToken), ResponseMessage.Found));

    #region CUENTA
    [HttpPut("{id:int}/Signature")]
    public Task<IActionResult> Signature(int id, [FromBody] SignatureRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await contentService.SaveSignature(id, request, cancellationToken), ResponseMessage.Updated));

    [HttpGet("{id:int}/Youtube/Playlists")]
    public Task<IActionResult> YoutubePlaylists(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.YoutubePlaylists(id, cancellationToken), ResponseMessage.Listed));

    [HttpPost("{id:int}/Test")]
    public Task<IActionResult> Test(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.Test(id, cancellationToken), ResponseMessage.Found));

    [HttpPost("{id:int}/Default")]
    public Task<IActionResult> SetDefault(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.SetDefault(id, cancellationToken), ResponseMessage.Updated));

    [HttpPut("{id:int}/Alias")]
    public Task<IActionResult> SaveAlias(int id, [FromBody] ConnectionAliasRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.SaveAlias(id, request, cancellationToken), ResponseMessage.Updated));

    [HttpDelete("{id:int}")]
    public Task<IActionResult> Disconnect(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.Disconnect(id, GetUserName, cancellationToken), ResponseMessage.Deleted));
    #endregion

    #region YOUTUBE
    [HttpGet("Youtube/Connect")]
    public Task<IActionResult> YoutubeConnect([FromQuery] OAuthConnectQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await youtubeAccountService.Connect(query, GetUserId, cancellationToken), ResponseMessage.Found));

    /// <summary>Vuelta del OAuth (igual en todas las plataformas): anónima, la protege el state firmado.</summary>
    [AllowAnonymous]
    [HttpGet("Youtube/Callback")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> YoutubeCallback([FromQuery] OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        Redirect(await youtubeAccountService.Callback(query, cancellationToken));

    [HttpGet("Youtube/Categories")]
    public Task<IActionResult> YoutubeCategories(CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await connectionService.Categories(googleSettings.Value.RegionCode, cancellationToken), ResponseMessage.Listed));
    #endregion

    #region FACEBOOK, INSTAGRAM Y WHATSAPP (token del usuario del sistema de Meta)
    [HttpPost("Facebook/Pages")]
    public Task<IActionResult> FacebookPages([FromBody] MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.FacebookPages(request, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Facebook")]
    public Task<IActionResult> FacebookSave([FromBody] MetaAccountsSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.FacebookSave(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("Instagram/Accounts")]
    public Task<IActionResult> InstagramAccounts([FromBody] MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.InstagramAccounts(request, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Instagram")]
    public Task<IActionResult> InstagramSave([FromBody] MetaAccountsSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.InstagramSave(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("WhatsApp/Numbers")]
    public Task<IActionResult> WhatsAppNumbers([FromBody] MetaTokenRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.WhatsAppNumbers(request, cancellationToken), ResponseMessage.Listed));

    [HttpPost("WhatsApp")]
    public Task<IActionResult> WhatsAppSave([FromBody] MetaAccountsSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await metaAccountService.WhatsAppSave(request, GetUserName, cancellationToken), ResponseMessage.Created));
    #endregion

    #region TELEGRAM
    [HttpPost("Telegram/Chats")]
    public Task<IActionResult> TelegramChats([FromBody] TelegramChatsRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await telegramAccountService.Chats(request, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Telegram")]
    public Task<IActionResult> TelegramSave([FromBody] TelegramChannelSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await telegramAccountService.Save(request, GetUserName, cancellationToken), ResponseMessage.Created));
    #endregion

    #region TIKTOK
    [HttpGet("Tiktok/Connect")]
    public Task<IActionResult> TiktokConnect([FromQuery] OAuthConnectQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await tiktokAccountService.Connect(query, GetUserId, cancellationToken), ResponseMessage.Found));

    [AllowAnonymous]
    [HttpGet("Tiktok/Callback")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> TiktokCallback([FromQuery] OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        Redirect(await tiktokAccountService.Callback(query, cancellationToken));

    [HttpGet("{id:int}/Tiktok/CreatorInfo")]
    public Task<IActionResult> TiktokCreatorInfo(int id, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await tiktokAccountService.CreatorInfo(id, cancellationToken), ResponseMessage.Found));
    #endregion

    #region LINKEDIN (perfil personal o páginas de empresa)
    [HttpGet("Linkedin/Connect")]
    public Task<IActionResult> LinkedinConnect([FromQuery] OAuthConnectQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await linkedinAccountService.Connect(false, query, GetUserId, cancellationToken), ResponseMessage.Found));

    [HttpGet("LinkedinOrg/Connect")]
    public Task<IActionResult> LinkedinOrgConnect([FromQuery] OAuthConnectQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await linkedinAccountService.Connect(true, query, GetUserId, cancellationToken), ResponseMessage.Found));

    [AllowAnonymous]
    [HttpGet("Linkedin/Callback")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> LinkedinCallback([FromQuery] OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        Redirect(await linkedinAccountService.Callback(false, query, cancellationToken));

    [AllowAnonymous]
    [HttpGet("LinkedinOrg/Callback")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> LinkedinOrgCallback([FromQuery] OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        Redirect(await linkedinAccountService.Callback(true, query, cancellationToken));
    #endregion

    #region TEAMS (Microsoft Graph o webhook de Workflows)
    [HttpGet("Teams/Connect")]
    public Task<IActionResult> TeamsConnect([FromQuery] OAuthConnectQuery query, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await teamsAccountService.Connect(query, GetUserId, cancellationToken), ResponseMessage.Found));

    [AllowAnonymous]
    [HttpGet("Teams/Callback")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> TeamsCallback([FromQuery] OAuthCallbackQuery query, CancellationToken cancellationToken) =>
        Redirect(await teamsAccountService.Callback(query, cancellationToken));

    [HttpGet("Teams/Channels")]
    public Task<IActionResult> TeamsChannels([FromQuery] string pick, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await teamsAccountService.Channels(pick ?? string.Empty, cancellationToken), ResponseMessage.Listed));

    [HttpPost("Teams")]
    public Task<IActionResult> TeamsSave([FromBody] TeamsChannelsSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await teamsAccountService.Save(request, GetUserName, cancellationToken), ResponseMessage.Created));

    [HttpPost("Teams/Webhook")]
    public Task<IActionResult> TeamsWebhook([FromBody] TeamsWebhookSaveRequest request, CancellationToken cancellationToken) =>
        exception.TryCatchActionAsync(async () => Reply(await teamsAccountService.SaveWebhook(request, GetUserName, cancellationToken), ResponseMessage.Created));
    #endregion
}
