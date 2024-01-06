#include "descriptor_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  DescriptorSet::Builder::Builder(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, uint32_t descSetCount) 
		: device{device}, descriptorPool{descriptorPool}, descSetCount{descSetCount}
	{
		
  }

	DescriptorSet::Builder& DescriptorSet::Builder::addBuffer(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, VkDescriptorBufferInfo bufferInfo) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorBufferInfos[binding].emplace_back(bufferInfo);
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;

		this->descriptorSetBindings[binding] = bind;
		
		return *this;
	}

	DescriptorSet::Builder& DescriptorSet::Builder::addBuffer(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, 
		const std::vector<VkDescriptorBufferInfo> &bufferInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorBufferInfos[binding].emplace_back(bufferInfos[i]);
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;

		this->descriptorSetBindings[binding] = bind;

		return *this;
	}

	DescriptorSet::Builder& DescriptorSet::Builder::addImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, VkDescriptorImageInfo imageInfo) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(std::vector<VkDescriptorImageInfo>{ imageInfo });
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;
		bind.descCount = 1u;

		this->descriptorSetBindings[binding] = bind;

		return *this;
	}

	DescriptorSet::Builder& DescriptorSet::Builder::addImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, 
		const std::vector<VkDescriptorImageInfo> &imageInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(std::vector<VkDescriptorImageInfo>{ imageInfos[i] });
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;
		bind.descCount = 1u;

		this->descriptorSetBindings[binding] = bind;

		return *this;
	}

	DescriptorSet::Builder& DescriptorSet::Builder::addManyImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, 
		const std::vector<VkDescriptorImageInfo> &imageInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(imageInfos);
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;
		bind.descCount = static_cast<uint32_t>(imageInfos.size());

		this->descriptorSetBindings[binding] = bind;

		return *this;
	}

	DescriptorSet::Builder& DescriptorSet::Builder::addManyImage(uint32_t binding, VkDescriptorType descriptorType, VkShaderStageFlags shaderStage, 
		const std::vector<std::vector<VkDescriptorImageInfo>> &imageInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(imageInfos[i]);
		}

		DescriptorSetBinding bind{};
		bind.descSetType = descriptorType;
		bind.shaderStage = shaderStage;
		bind.descCount = static_cast<uint32_t>(imageInfos.size());

		this->descriptorSetBindings[binding] = bind;

		return *this;
	}

	DescriptorSet* DescriptorSet::Builder::build() {
		return new DescriptorSet(this->device, this->descriptorPool, this->descSetCount, this->descriptorSetBindings, 
			this->descriptorBufferInfos, this->descriptorImageInfos);
	}

	DescriptorSet::Overwriter::Overwriter(uint32_t descSetCount) 
		: descSetCount{descSetCount}
	{

  }

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addBuffer(uint32_t binding, VkDescriptorBufferInfo bufferInfo) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorBufferInfos[binding].emplace_back(bufferInfo);
		}

		return *this;
	}

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addBuffer(uint32_t binding, const std::vector<VkDescriptorBufferInfo> &bufferInfos) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorBufferInfos[binding].emplace_back(bufferInfos[i]);
		}

		return *this;
	}

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addImage(uint32_t binding, VkDescriptorImageInfo imageInfo) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(std::vector<VkDescriptorImageInfo>{ imageInfo });
		}

		return *this;
	}

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addImage(uint32_t binding, const std::vector<VkDescriptorImageInfo> &imageInfos) {
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(std::vector<VkDescriptorImageInfo>{ imageInfos[i] });
		}

		return *this;
	}

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addManyImage(uint32_t binding, const std::vector<VkDescriptorImageInfo> &imageInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(imageInfos);
		}

		return *this;
	}

	DescriptorSet::Overwriter& DescriptorSet::Overwriter::addManyImage(uint32_t binding, const std::vector<std::vector<VkDescriptorImageInfo>> &imageInfos) 
	{
		for (uint32_t i = 0; i < this->descSetCount; i++) {
			this->descriptorImageInfos[binding].emplace_back(imageInfos[i]);
		}

		return *this;
	}

	void DescriptorSet::Overwriter::overwrite(DescriptorSet* descriptorSet) {
		descriptorSet->overwrite(this->descriptorBufferInfos, this->descriptorImageInfos);
	}

	DescriptorSet::DescriptorSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, uint32_t descSetCount, std::unordered_map<uint32_t, DescriptorSetBinding> descriptorSetBindings, 
		std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos, std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos)
		: device{device}, descriptorPool{descriptorPool}, descSetCount{descSetCount}
	{
		this->createDescriptorLayout(descriptorSetBindings);

		this->descriptorSets.clear();
		this->descriptorSets.resize(descSetCount);

		this->createDescriptorSet(descriptorBufferInfos, descriptorImageInfos);
	}


	DescriptorSet::~DescriptorSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

	void DescriptorSet::createDescriptorLayout(std::unordered_map<uint32_t, DescriptorSetBinding> descriptorSetBindings) {
		auto descSetLayoutBuilder = NugieVulkan::DescriptorSetLayout::Builder(this->device);

		for (auto &&descriptorSetBinding : descriptorSetBindings) {
			descSetLayoutBuilder.addBinding(descriptorSetBinding.first, descriptorSetBinding.second.descSetType, 
				descriptorSetBinding.second.shaderStage, descriptorSetBinding.second.descCount);
		}

		this->descSetLayout = descSetLayoutBuilder.build();
	}

  void DescriptorSet::createDescriptorSet(std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos, 
		std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos)
	{
		auto descriptorWriter = NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool);

		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			descriptorWriter.clear();

			for (auto &&descriptorBufferInfo : descriptorBufferInfos) {
				descriptorWriter.writeBuffer(descriptorBufferInfo.first, descriptorBufferInfo.second[i]);
			}

			for (auto &&descriptorImageInfo : descriptorImageInfos) {
				descriptorWriter.writeImage(descriptorImageInfo.first, descriptorImageInfo.second[i]);
			}

			descriptorWriter.build(&this->descriptorSets[i]);
		}
  }

	void DescriptorSet::overwrite(std::unordered_map<uint32_t, std::vector<VkDescriptorBufferInfo>> descriptorBufferInfos, 
		std::unordered_map<uint32_t, std::vector<std::vector<VkDescriptorImageInfo>>> descriptorImageInfos)
	{
		auto descriptorWriter = NugieVulkan::DescriptorWriter(this->device, this->descSetLayout, this->descriptorPool);

		for (size_t i = 0; i < this->descriptorSets.size(); i++) {
			descriptorWriter.clear();

			for (auto &&descriptorBufferInfo : descriptorBufferInfos) {
				descriptorWriter.writeBuffer(descriptorBufferInfo.first, descriptorBufferInfo.second[i]);
			}

			for (auto &&descriptorImageInfo : descriptorImageInfos) {
				descriptorWriter.writeImage(descriptorImageInfo.first, descriptorImageInfo.second[i]);
			}

			descriptorWriter.overwrite(&this->descriptorSets[i]);
		}
	}
}