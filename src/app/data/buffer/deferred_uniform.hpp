#pragma once

#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/pipeline/compute_pipeline.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../general_struct.hpp"

#include <memory>
#include <vector>

namespace NugieApp {
	class DeferredUniform {
		public:
			DeferredUniform(NugieVulkan::Device* device);
			~DeferredUniform();

			std::vector<VkDescriptorBufferInfo> getBuffersInfo() const;

			void writeGlobalData(uint32_t frameIndex, DeferredUbo ubo);

		private:
      NugieVulkan::Device* device;
			std::vector<NugieVulkan::Buffer*> uniformBuffers;

			void createUniformBuffer();
	};
}