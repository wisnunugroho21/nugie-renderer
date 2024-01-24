#pragma once

#include "../../../vulkan/command/command_buffer.hpp"
#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/pipeline/compute_pipeline.hpp"
#include "../../../vulkan/buffer/buffer.hpp"

#include <memory>
#include <vector>

namespace NugieApp {
	template <typename T>
	class ObjectBuffer {
		public:
			ObjectBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags);
			~ObjectBuffer();

			std::vector<VkDescriptorBufferInfo> getInfo() const;

			void writeGlobalData(uint32_t frameIndex, T ubo);

		private:
      NugieVulkan::Device* device;
			std::vector<NugieVulkan::Buffer*> uniformBuffers;

			void createBuffer(VkBufferUsageFlags usageFlags);
	};

	template <typename T>
	ObjectBuffer<T>::ObjectBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags) : device{device} {
		this->createBuffer(usageFlags);
	}

	template <typename T>
	ObjectBuffer<T>::~ObjectBuffer() {
		for (auto &&uniformBuffer : this->uniformBuffers) {
			if (uniformBuffer != nullptr) delete uniformBuffer;
		}
	}

	template <typename T>
	std::vector<VkDescriptorBufferInfo> ObjectBuffer<T>::getInfo() const {
		std::vector<VkDescriptorBufferInfo> buffersInfo{};
		
		for (int i = 0; i < this->uniformBuffers.size(); i++) {
			buffersInfo.emplace_back(uniformBuffers[i]->descriptorInfo());
		}

		return buffersInfo;
	}

	template <typename T>
	void ObjectBuffer<T>::createBuffer(VkBufferUsageFlags usageFlags) {
		this->uniformBuffers.clear();

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			auto uniformBuffer = new NugieVulkan::Buffer(
				this->device,
				sizeof(T),
				1u,
				usageFlags,
				VMA_MEMORY_USAGE_AUTO_PREFER_HOST,
				VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT
			);

			uniformBuffer->map();
			this->uniformBuffers.emplace_back(uniformBuffer);
		}
	}

	template <typename T>
	void ObjectBuffer<T>::writeGlobalData(uint32_t frameIndex, T ubo) {
		this->uniformBuffers[frameIndex]->writeToBuffer(&ubo);
		this->uniformBuffers[frameIndex]->flush();
	}
}