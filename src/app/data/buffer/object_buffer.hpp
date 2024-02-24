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

			NugieVulkan::Buffer* getBuffer(uint32_t index) const { return this->buffers[index]; }
			std::vector<VkDescriptorBufferInfo> getInfo() const;

			void writeGlobalData(uint32_t frameIndex, T ubo);

		private:
      NugieVulkan::Device* device = nullptr;
			std::vector<NugieVulkan::Buffer*> buffers;

			void createBuffer(VkBufferUsageFlags usageFlags);
	};

	template <typename T>
	ObjectBuffer<T>::ObjectBuffer(NugieVulkan::Device* device, VkBufferUsageFlags usageFlags) : device{device} {
		this->createBuffer(usageFlags);
	}

	template <typename T>
	ObjectBuffer<T>::~ObjectBuffer() {
		for (auto &&buffer : this->buffers) {
			if (buffer != nullptr) delete buffer;
		}
	}

	template <typename T>
	std::vector<VkDescriptorBufferInfo> ObjectBuffer<T>::getInfo() const {
		std::vector<VkDescriptorBufferInfo> buffersInfo{};
		
		for (int i = 0; i < this->buffers.size(); i++) {
			buffersInfo.emplace_back(this->buffers[i]->descriptorInfo());
		}

		return buffersInfo;
	}

	template <typename T>
	void ObjectBuffer<T>::createBuffer(VkBufferUsageFlags usageFlags) {
		this->buffers.clear();

		for (uint32_t i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			auto buffer = new NugieVulkan::Buffer(
				this->device,
				sizeof(T),
				1u,
				usageFlags,
				VMA_MEMORY_USAGE_AUTO_PREFER_HOST,
				VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT
			);

			buffer->map();
			this->buffers.emplace_back(buffer);
		}
	}

	template <typename T>
	void ObjectBuffer<T>::writeGlobalData(uint32_t frameIndex, T ubo) {
		this->buffers[frameIndex]->writeToBuffer(&ubo);
		this->buffers[frameIndex]->flush();
	}
}