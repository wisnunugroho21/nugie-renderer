#pragma once

#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/pipeline/compute_pipeline.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../general_struct.hpp"

#include <memory>
#include <vector>

namespace NugieApp {
	template <typename T>
	class UniformBufferObject {
		public:
			UniformBufferObject(NugieVulkan::Device* device);
			~UniformBufferObject();

			std::vector<VkDescriptorBufferInfo> getInfo() const;

			void writeGlobalData(uint32_t frameIndex, T ubo);

		private:
      NugieVulkan::Device* device;
			std::vector<NugieVulkan::Buffer*> uniformBuffers;

			void createUniformBuffer();
	};

	template <typename T>
	UniformBufferObject<T>::UniformBufferObject(NugieVulkan::Device* device) : device{device} {
		this->createUniformBuffer();
	}

	template <typename T>
	UniformBufferObject<T>::~UniformBufferObject() {
		for (auto &&uniformBuffer : this->uniformBuffers) {
			if (uniformBuffer != nullptr) delete uniformBuffer;
		}
	}

	template <typename T>
	std::vector<VkDescriptorBufferInfo> UniformBufferObject<T>::getInfo() const {
		std::vector<VkDescriptorBufferInfo> buffersInfo{};
		
		for (int i = 0; i < this->uniformBuffers.size(); i++) {
			buffersInfo.emplace_back(uniformBuffers[i]->descriptorInfo());
		}

		return buffersInfo;
	}

	template <typename T>
	void UniformBufferObject<T>::createUniformBuffer() {
		this->uniformBuffers.clear();

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			auto uniformBuffer = new NugieVulkan::Buffer(
				this->device,
				sizeof(T),
				1u,
				VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT,
				VK_MEMORY_PROPERTY_HOST_VISIBLE_BIT
			);

			uniformBuffer->map();
			this->uniformBuffers.emplace_back(uniformBuffer);
		}
	}

	template <typename T>
	void UniformBufferObject<T>::writeGlobalData(uint32_t frameIndex, T ubo) {
		this->uniformBuffers[frameIndex]->writeToBuffer(&ubo);
		this->uniformBuffers[frameIndex]->flush();
	}
}