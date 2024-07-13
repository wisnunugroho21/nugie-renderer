#pragma once

#include "../graphic_render_system.hpp"

#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/pipeline/graphic_pipeline.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"
#include "../../../vulkan/swap_chain/swap_chain.hpp"
#include "../../../vulkan/renderpass/renderpass.hpp"

#include "../../general_struct.hpp"

#include <vector>

namespace NugieApp {
	class MeshRenderSystem : public GraphicRenderSystem {
	public:
		MeshRenderSystem(NugieVulkan::Device *device, NugieVulkan::RenderPass *renderPass,
						 std::string taskFilePath, std::string meshFilePath, 
						 std::string fragFilePath,
						 NugieVulkan::DeviceProcedures *deviceProcedures,
						 const std::vector<NugieVulkan::DescriptorSetLayout *> &descriptorSetLayouts = {},
						 const std::vector<VkPushConstantRange> &pushConstantRanges = {});

		void render(NugieVulkan::CommandBuffer *commandBuffer);

	private:
		void createPipeline() override;

		NugieVulkan::DeviceProcedures *deviceProcedures = nullptr;
		std::string taskFilePath, meshFilePath;
	};
}