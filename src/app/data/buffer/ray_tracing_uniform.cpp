#include "ray_tracing_uniform.hpp"

#define GLM_FORCE_RADIANS
#define GLM_FORCE_DEPTH_ZERO_TO_ONE
#include <glm/glm.hpp>
#include <glm/gtc/constants.hpp>

#include <stdexcept>
#include <array>
#include <string>

namespace NugieApp {
	RayTracingUniform::RayTracingUniform(NugieVulkan::Device* device) : device{device} {
		this->createUniformBuffer();
	}

	RayTracingUniform::~RayTracingUniform() {
		for (auto &&uniformBuffer : this->uniformBuffers) {
			if (uniformBuffer != nullptr) delete uniformBuffer;
		}
	}

	std::vector<VkDescriptorBufferInfo> RayTracingUniform::getBuffersInfo() const {
		std::vector<VkDescriptorBufferInfo> buffersInfo{};
		
		for (int i = 0; i < this->uniformBuffers.size(); i++) {
			buffersInfo.emplace_back(uniformBuffers[i]->descriptorInfo());
		}

		return buffersInfo;
	}

	void RayTracingUniform::createUniformBuffer() {
		this->uniformBuffers.clear();

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			auto uniformBuffer = new NugieVulkan::Buffer(
				this->device,
				sizeof(RayTraceUbo),
				1u,
				VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
				VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
			);

			uniformBuffer->map();
			this->uniformBuffers.emplace_back(uniformBuffer);
		}
	}

	void RayTracingUniform::writeGlobalData(uint32_t frameIndex, RayTraceUbo ubo) {
		this->uniformBuffers[frameIndex]->writeToBuffer(&ubo);
		this->uniformBuffers[frameIndex]->flush();
	}
}