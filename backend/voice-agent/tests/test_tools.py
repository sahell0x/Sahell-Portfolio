"""Page-control tool definitions and the config Vox consumes."""

from vox.helpers.function_calling_helpers import CLIENT_RPC_SCHEME
from vox.models import AgentModel

from app.agent_config import build_agent_config
from app.tools import (
    SECTIONS,
    TOOL_DEFINITIONS,
    TOOL_NAMES,
    build_api_tools,
)


class TestToolSchemas:
    def test_every_tool_is_openai_strict_compatible(self):
        """Strict mode needs additionalProperties:false and all props required."""
        for definition in TOOL_DEFINITIONS:
            params = definition["function"]["parameters"]
            assert definition["function"]["strict"] is True
            assert params["additionalProperties"] is False
            assert set(params["required"]) == set(params["properties"])

    def test_every_tool_has_a_description(self):
        for definition in TOOL_DEFINITIONS:
            assert len(definition["function"]["description"]) > 20

    def test_show_section_enumerates_real_sections(self):
        tool = next(t for t in TOOL_DEFINITIONS if t["function"]["name"] == "show_section")
        assert tool["function"]["parameters"]["properties"]["section"]["enum"] == list(SECTIONS)


class TestApiTools:
    def test_every_tool_is_fulfilled_by_the_browser(self):
        """The rpc scheme is what makes trigger_api skip the network entirely."""
        tools = build_api_tools()
        for name, params in tools["tools_params"].items():
            assert params["url"] == f"{CLIENT_RPC_SCHEME}{name}"

    def test_carries_no_session_id_or_token(self):
        """The call goes down one conversation's own socket, so neither is needed."""
        tools = build_api_tools()
        for params in tools["tools_params"].values():
            assert "session_id" not in params["url"]
            assert "api_token" not in params

    def test_show_section_uses_a_var_marker(self):
        """Vox substitutes LLM args via {"$var": ...} in prepare_api_request."""
        tools = build_api_tools()
        assert tools["tools_params"]["show_section"]["param"] == {"section": {"$var": "section"}}

    def test_no_argument_tools_send_no_body(self):
        tools = build_api_tools()
        assert tools["tools_params"]["open_terminal"]["param"] is None

    def test_covers_every_declared_tool(self):
        tools = build_api_tools()
        assert set(tools["tools_params"]) == set(TOOL_NAMES)


class TestAgentConfig:
    def test_validates_against_voxs_own_schema(self):
        """Catches config drift at test time instead of mid-call."""
        AgentModel(**build_agent_config())

    def test_uses_the_sarvam_and_openai_stack(self):
        tools_config = build_agent_config()["tasks"][0]["tools_config"]
        assert tools_config["transcriber"]["provider"] == "sarvam"
        assert tools_config["transcriber"]["model"] == "saaras:v3"
        assert tools_config["synthesizer"]["provider_config"]["model"] == "bulbul:v3"
        assert tools_config["llm_agent"]["llm_config"]["provider"] == "openai"

    def test_stt_language_is_auto_detect(self):
        """"unknown" is what enables Saaras v3 code-mixed Hinglish detection."""
        tools_config = build_agent_config()["tasks"][0]["tools_config"]
        assert tools_config["transcriber"]["language"] == "unknown"

    def test_streams_both_directions(self):
        tools_config = build_agent_config()["tasks"][0]["tools_config"]
        assert tools_config["transcriber"]["stream"] is True
        assert tools_config["synthesizer"]["stream"] is True

    def test_uses_voxs_own_web_call_handlers(self):
        """"default" is Vox's browser transport: JSON frames on a socket, base64
        PCM both ways, and `mark` events the client echoes once audio has played."""
        tools_config = build_agent_config()["tasks"][0]["tools_config"]
        assert tools_config["input"]["provider"] == "default"
        assert tools_config["output"]["provider"] == "default"

    def test_stt_rate_is_what_saaras_wants(self):
        tools_config = build_agent_config()["tasks"][0]["tools_config"]
        assert tools_config["transcriber"]["sampling_rate"] == 16000

    def test_tts_rate_matches_the_models_native_rate(self):
        """Any mismatch makes the synthesizer resample_poly() every chunk with no
        filter state carried across boundaries, which clicks between sentences.
        The browser is told this rate in the session response and resamples on
        playout, so the engine never has to."""
        from vox.constants import SARVAM_MODEL_SAMPLING_RATE_MAPPING

        from app.config import settings

        native = SARVAM_MODEL_SAMPLING_RATE_MAPPING[settings.tts_model]
        tools_config = build_agent_config()["tasks"][0]["tools_config"]

        assert settings.tts_sample_rate == native
        assert tools_config["synthesizer"]["provider_config"]["sampling_rate"] == native

    def test_session_cap_reaches_vox(self):
        from app.config import settings

        config = build_agent_config()
        assert config["tasks"][0]["task_config"]["call_terminate"] == settings.session_seconds

    def test_pipeline_is_transcriber_llm_synthesizer(self):
        config = build_agent_config()
        assert config["tasks"][0]["toolchain"]["pipelines"] == [
            ["transcriber", "llm", "synthesizer"]
        ]


class TestClientFulfilledDispatch:
    """The scheme is the whole mechanism: it is what keeps a page action off the
    network, and so out of reach of the SSRF policy it would otherwise need an
    exemption from."""

    async def test_a_page_action_is_asked_of_the_transport_not_the_network(self):
        from vox.helpers.function_calling_helpers import trigger_api

        calls = []

        class FakeTransport:
            async def perform_rpc(self, method, payload, timeout=8.0):
                calls.append((method, payload))
                return "Done — that section is now on screen."

        response = await trigger_api(
            url=f"{CLIENT_RPC_SCHEME}show_section",
            method="post",
            param={"section": {"$var": "section"}},
            api_token=None,
            headers_data=None,
            meta_info={},
            run_id=None,
            transport=FakeTransport(),
            section="projects",
        )

        assert calls == [("show_section", {"section": "projects"})]
        assert response == "Done — that section is now on screen."

    async def test_without_a_client_the_agent_is_told_it_failed(self):
        """It has to be able to say so out loud rather than claim it scrolled."""
        from vox.helpers.function_calling_helpers import trigger_api

        response = await trigger_api(
            url=f"{CLIENT_RPC_SCHEME}open_terminal",
            method="post",
            param=None,
            api_token=None,
            headers_data=None,
            meta_info={},
            run_id=None,
            transport=None,
        )

        assert "ERROR" in response
