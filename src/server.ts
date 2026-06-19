import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Auth } from "./auth.js";
import type { Api } from "./api.js";

// ── Zod schemas ────────────────────────────────────────────────────────────

const PropertyIdSchema = z.object({ propertyId: z.coerce.number().int().positive() });
const AvailIdSchema = z.object({ availabilityId: z.coerce.number().int().positive() });
const UnavailIdSchema = z.object({ unavailabilityId: z.coerce.number().int().positive() });
const AddAvailSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sim: z.boolean().optional(),
  non_sim: z.boolean().optional(),
  non_reciprocal: z.boolean().optional(),
  hospitality: z.boolean().optional(),
});
const AddUnavailSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
const ConversationsSchema = z.object({
  filter: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
});
const MessagesSchema = z.object({
  userId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
});
const SendMessageSchema = z.object({
  toUserId: z.coerce.number().int().positive(),
  body: z.string().min(1),
  propertyId: z.coerce.number().int().positive(),
  chatId: z.coerce.number().int().positive().optional(),
  exchangeId: z.string().optional(),
});
const DeleteMessageSchema = z.object({ messageId: z.coerce.number().int().positive() });
const DeleteChatSchema = z.object({ chatId: z.coerce.number().int().positive() });
const ExchangeIdSchema = z.object({ exchangeId: z.coerce.number().int().positive() });
const CreateExchangeSchema = z.object({
  userId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive(),
});
const UpdateExchangeDatesSchema = z.object({
  exchangeId: z.coerce.number().int().positive(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});
const UpdateExchangeTypeSchema = z.object({
  exchangeId: z.coerce.number().int().positive(),
  swapType: z.enum(["simultaneous", "non_simultaneous", "non_reciprocal", "hospitality"]),
});
const SearchSchema = z.object({
  location: z.string().optional(),
  country: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  guests: z.coerce.number().optional(),
  page: z.coerce.number().optional(),
});
const QuickSearchSchema = z.object({ listingNumber: z.coerce.number().int().positive() });
const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const SetCookiesSchema = z.object({ cookies: z.string().min(10) });

// ── Tool definitions ───────────────────────────────────────────────────────

const tools = [
  // Auth
  { name: "plu_auth_status", description: "Check authentication status", inputSchema: { type: "object" as const, properties: {}, required: [] } },
  { name: "plu_login", description: "Login with email and password. IMPORTANT: ask user confirmation before sending credentials.", inputSchema: { type: "object" as const, properties: { email: { type: "string", description: "Email address" }, password: { type: "string", description: "Password" } }, required: ["email", "password"] } },
  { name: "plu_set_cookies", description: "Inject raw browser cookies for authentication. Get from DevTools → Application → Cookies → document.cookie", inputSchema: { type: "object" as const, properties: { cookies: { type: "string", description: "Raw cookie string" } }, required: ["cookies"] } },

  // Properties
  { name: "plu_get_property", description: "Get property details by ID (public page). Note: PeopleLikeUs rate-limits requests; the server already throttles and retries on 429, so prefer sequential calls over firing many in tight succession.", inputSchema: { type: "object" as const, properties: { propertyId: { type: "number", description: "Property ID" } }, required: ["propertyId"] } },
  { name: "plu_get_my_properties", description: "Get my properties list", inputSchema: { type: "object" as const, properties: {}, required: [] } },

  // Calendar
  { name: "plu_get_availabilities", description: "Get availability periods for a property (JSON API). Note: PeopleLikeUs rate-limits requests; prefer sequential calls over firing many in tight succession.", inputSchema: { type: "object" as const, properties: { propertyId: { type: "number", description: "Property ID" } }, required: ["propertyId"] } },
  { name: "plu_get_unavailabilities", description: "Get unavailability periods for a property (JSON API). Note: PeopleLikeUs rate-limits requests; prefer sequential calls over firing many in tight succession.", inputSchema: { type: "object" as const, properties: { propertyId: { type: "number", description: "Property ID" } }, required: ["propertyId"] } },
  { name: "plu_add_availability", description: "Add an availability period. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { propertyId: { type: "number" }, startDate: { type: "string", description: "YYYY-MM-DD" }, endDate: { type: "string", description: "YYYY-MM-DD" }, sim: { type: "boolean", description: "Accept simultaneous" }, non_sim: { type: "boolean", description: "Accept non-simultaneous" }, non_reciprocal: { type: "boolean", description: "Accept non-reciprocal" }, hospitality: { type: "boolean", description: "Accept hospitality" } }, required: ["propertyId", "startDate", "endDate"] } },
  { name: "plu_delete_availability", description: "Delete an availability period. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { availabilityId: { type: "number" } }, required: ["availabilityId"] } },
  { name: "plu_add_unavailability", description: "Add an unavailability period. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { propertyId: { type: "number" }, startDate: { type: "string", description: "YYYY-MM-DD" }, endDate: { type: "string", description: "YYYY-MM-DD" } }, required: ["propertyId", "startDate", "endDate"] } },
  { name: "plu_delete_unavailability", description: "Delete an unavailability period. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { unavailabilityId: { type: "number" } }, required: ["unavailabilityId"] } },

  // Conversations & Messages
  { name: "plu_get_conversations", description: "Get conversation list. Filters: 'unread', 'exchanges', 'action_needed', 'flagged', 'received', 'sent', 'trash'", inputSchema: { type: "object" as const, properties: { filter: { type: "string", description: "Filter type" }, page: { type: "number", description: "Page number (default 1)" } } } },
  { name: "plu_get_messages", description: "Get messages in a conversation thread. Note: PeopleLikeUs rate-limits requests; prefer sequential calls over firing many in tight succession.", inputSchema: { type: "object" as const, properties: { userId: { type: "number", description: "Other user's ID" }, propertyId: { type: "number", description: "Property ID for the conversation" } }, required: ["userId", "propertyId"] } },
  { name: "plu_send_message", description: "Send a message to a user. IMPORTANT: ask user confirmation before sending.", inputSchema: { type: "object" as const, properties: { toUserId: { type: "number", description: "Recipient user ID" }, body: { type: "string", description: "Message content (HTML allowed)" }, propertyId: { type: "number", description: "Property ID context" }, chatId: { type: "number", description: "Chat ID (optional, for existing conversations)" }, exchangeId: { type: "string", description: "Exchange ID (optional)" } }, required: ["toUserId", "body", "propertyId"] } },
  { name: "plu_delete_message", description: "Delete a message. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { messageId: { type: "number" } }, required: ["messageId"] } },
  { name: "plu_delete_conversation", description: "Delete/trash a conversation. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { chatId: { type: "number" } }, required: ["chatId"] } },

  // Exchanges
  { name: "plu_get_exchanges", description: "Get my exchanges list", inputSchema: { type: "object" as const, properties: {}, required: [] } },
  { name: "plu_get_exchange", description: "Get exchange details", inputSchema: { type: "object" as const, properties: { exchangeId: { type: "number" } }, required: ["exchangeId"] } },
  { name: "plu_create_exchange", description: "Create/propose a new exchange. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { userId: { type: "number", description: "Partner user ID" }, propertyId: { type: "number", description: "Partner property ID" } }, required: ["userId", "propertyId"] } },
  { name: "plu_update_exchange_dates", description: "Update exchange dates. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { exchangeId: { type: "number" }, startDate: { type: "string", description: "YYYY-MM-DD" }, endDate: { type: "string", description: "YYYY-MM-DD" } }, required: ["exchangeId", "startDate", "endDate"] } },
  { name: "plu_update_exchange_type", description: "Update exchange type. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { exchangeId: { type: "number" }, swapType: { type: "string", description: "simultaneous | non_simultaneous | non_reciprocal | hospitality" } }, required: ["exchangeId", "swapType"] } },
  { name: "plu_cancel_exchange", description: "Cancel an exchange. IMPORTANT: ask user confirmation.", inputSchema: { type: "object" as const, properties: { exchangeId: { type: "number" } }, required: ["exchangeId"] } },

  // Search
  { name: "plu_search_homes", description: "Search homes with filters", inputSchema: { type: "object" as const, properties: { location: { type: "string" }, country: { type: "string" }, startDate: { type: "string" }, endDate: { type: "string" }, guests: { type: "number" }, page: { type: "number" } } } },
  { name: "plu_quick_search", description: "Search by listing number", inputSchema: { type: "object" as const, properties: { listingNumber: { type: "number" } }, required: ["listingNumber"] } },

  // Misc
  { name: "plu_get_notifications", description: "Get notifications (JSON)", inputSchema: { type: "object" as const, properties: {}, required: [] } },
  { name: "plu_get_auth_user", description: "Get authenticated user info", inputSchema: { type: "object" as const, properties: {}, required: [] } },
];

// ── Helper ─────────────────────────────────────────────────────────────────

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// ── Server setup ───────────────────────────────────────────────────────────

export function createServer(auth: Auth, api: Api): Server {
  const server = new Server(
    { name: "peoplelikeus-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      // Auth tools (no session required)
      switch (name) {
        case "plu_auth_status":
          return textResult(auth.getStatus());
        case "plu_login": {
          const { email, password } = LoginSchema.parse(args);
          await auth.login(email, password);
          return textResult({ success: true, ...auth.getStatus() });
        }
        case "plu_set_cookies": {
          const { cookies } = SetCookiesSchema.parse(args);
          auth.setCookies(cookies);
          return textResult({ success: true, ...auth.getStatus() });
        }
      }

      // All other tools require auth
      await auth.ensureAuthenticated();

      switch (name) {
        // Properties
        case "plu_get_property": {
          const { propertyId } = PropertyIdSchema.parse(args);
          return textResult(await api.getProperty(propertyId));
        }
        case "plu_get_my_properties":
          return textResult(await api.getMyProperties());

        // Calendar
        case "plu_get_availabilities": {
          const { propertyId } = PropertyIdSchema.parse(args);
          return textResult(await api.getAvailabilities(propertyId));
        }
        case "plu_get_unavailabilities": {
          const { propertyId } = PropertyIdSchema.parse(args);
          return textResult(await api.getUnavailabilities(propertyId));
        }
        case "plu_add_availability": {
          const { propertyId, startDate, endDate, ...opts } = AddAvailSchema.parse(args);
          return textResult(await api.addAvailability(propertyId, startDate, endDate, opts));
        }
        case "plu_delete_availability": {
          const { availabilityId } = AvailIdSchema.parse(args);
          return textResult(await api.deleteAvailability(availabilityId));
        }
        case "plu_add_unavailability": {
          const { propertyId, startDate, endDate } = AddUnavailSchema.parse(args);
          return textResult(await api.addUnavailability(propertyId, startDate, endDate));
        }
        case "plu_delete_unavailability": {
          const { unavailabilityId } = UnavailIdSchema.parse(args);
          return textResult(await api.deleteUnavailability(unavailabilityId));
        }

        // Conversations
        case "plu_get_conversations": {
          const { filter, page } = ConversationsSchema.parse(args);
          return textResult(await api.getConversations(filter, page));
        }
        case "plu_get_messages": {
          const { userId, propertyId } = MessagesSchema.parse(args);
          return textResult(await api.getMessages(userId, propertyId));
        }
        case "plu_send_message": {
          const { toUserId, body, propertyId, chatId, exchangeId } = SendMessageSchema.parse(args);
          return textResult(await api.sendMessage(toUserId, body, propertyId, chatId, exchangeId));
        }
        case "plu_delete_message": {
          const { messageId } = DeleteMessageSchema.parse(args);
          return textResult(await api.deleteMessage(messageId));
        }
        case "plu_delete_conversation": {
          const { chatId } = DeleteChatSchema.parse(args);
          return textResult(await api.deleteConversation(chatId));
        }

        // Exchanges
        case "plu_get_exchanges":
          return textResult(await api.getExchanges());
        case "plu_get_exchange": {
          const { exchangeId } = ExchangeIdSchema.parse(args);
          return textResult(await api.getExchange(exchangeId));
        }
        case "plu_create_exchange": {
          const { userId, propertyId } = CreateExchangeSchema.parse(args);
          return textResult(await api.createExchange(userId, propertyId));
        }
        case "plu_update_exchange_dates": {
          const { exchangeId, startDate, endDate } = UpdateExchangeDatesSchema.parse(args);
          return textResult(await api.updateExchangeDates(exchangeId, startDate, endDate));
        }
        case "plu_update_exchange_type": {
          const { exchangeId, swapType } = UpdateExchangeTypeSchema.parse(args);
          return textResult(await api.updateExchangeType(exchangeId, swapType));
        }
        case "plu_cancel_exchange": {
          const { exchangeId } = ExchangeIdSchema.parse(args);
          return textResult(await api.cancelExchange(exchangeId));
        }

        // Search
        case "plu_search_homes": {
          const params = SearchSchema.parse(args);
          const searchParams: Record<string, string> = {};
          if (params.location) searchParams.search = params.location;
          if (params.country) searchParams.country_long = params.country;
          if (params.startDate) searchParams.start_date = params.startDate;
          if (params.endDate) searchParams.end_date = params.endDate;
          if (params.guests) searchParams.guests = String(params.guests);
          if (params.page) searchParams.page = String(params.page);
          return textResult(await api.searchHomes(searchParams));
        }
        case "plu_quick_search": {
          const { listingNumber } = QuickSearchSchema.parse(args);
          return textResult(await api.quickSearch(listingNumber));
        }

        // Misc
        case "plu_get_notifications":
          return textResult(await api.getNotifications());
        case "plu_get_auth_user":
          return textResult(await api.getAuthUser());

        default:
          return textResult({ error: `Unknown tool: ${name}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }], isError: true };
    }
  });

  return server;
}
